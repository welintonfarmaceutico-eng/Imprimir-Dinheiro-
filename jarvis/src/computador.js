// Ponte entre o Jarvis e o programa instalado no PC do usuário.
// O PC fala direto com o Jarvis: fica "esperando ordem" em /api/pc/esperar (cada pedido aguarda até
// ~25 s por uma ordem) e devolve o resultado em /api/pc/resposta. As ordens ficam no próprio banco.
// Toda ordem e toda resposta são assinadas com uma chave secreta (HMAC-SHA256) que só o Jarvis e o PC conhecem.
import crypto from "node:crypto";
import { MODELO_PC } from "./jarvis-pc-modelo.js";

const ACOES = ["abrir_programa", "abrir_site", "volume", "ping"];
const ESPERA_MS = 9000; // quanto tempo o Jarvis espera o PC responder
const ESPERA_PC_MS = 25000; // quanto tempo cada pedido do PC fica aguardando uma ordem
const VALIDADE_S = 300; // assinaturas valem 5 minutos
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export class Computador {
  constructor(armazem, { esperaMs = ESPERA_MS, esperaPcMs = ESPERA_PC_MS, intervaloMs = 500 } = {}) {
    this.armazem = armazem;
    this.esperaMs = esperaMs;
    this.esperaPcMs = esperaPcMs;
    this.intervaloMs = intervaloMs;
  }

  async chave({ criar = false } = {}) {
    const conf = await this.armazem.obter("config", "pc");
    if (conf?.chave || !criar) return conf?.chave ?? null;
    const chave = crypto.randomBytes(24).toString("hex");
    await this.armazem.salvar("config", "pc", { chave, criadoEm: new Date().toISOString() });
    return chave;
  }

  static assinar(chave, texto) {
    return crypto.createHmac("sha256", chave).update(texto, "utf8").digest("hex");
  }

  static #iguais(a, b) {
    const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  async configurado() {
    return Boolean(await this.chave());
  }

  // O programa do PC pergunta por ordens a cada ~25 s; visto há menos de 1 minuto = ligado agora.
  async online() {
    const visto = await this.armazem.obter("config", "pc-visto");
    return Boolean(visto && Date.now() - new Date(visto.em).getTime() < 60000);
  }

  async desconectar() {
    await this.armazem.apagar("config", "pc");
  }

  // Script do PowerShell já com a chave e o endereço deste Jarvis (com BOM: o PowerShell 5 lê acentos certo).
  async instalador(origem) {
    const chave = await this.chave({ criar: true });
    const script = MODELO_PC.replaceAll("__CHAVE__", chave).replaceAll("__SERVIDOR__", String(origem).replace(/\/+$/, ""));
    return "\ufeff" + script.replace(/\r?\n/g, "\r\n");
  }

  // ---------- Lado do Jarvis ----------
  // Deixa a ordem na fila e espera a resposta assinada do PC.
  async executar(acao, alvo = "") {
    if (!ACOES.includes(acao)) throw new Error(`Ação não permitida: ${acao}`);
    const chave = await this.chave();
    if (!chave) throw new Error('O computador ainda não foi conectado. Vá em Ajustes (⚙), na parte "Computador", e baixe o programa do PC.');
    const id = crypto.randomBytes(8).toString("hex");
    const ts = Math.floor(Date.now() / 1000);
    alvo = String(alvo ?? "").slice(0, 300);
    const sig = Computador.assinar(chave, `${id}|${acao}|${alvo}|${ts}`);
    await this.armazem.salvar("pc-fila", id, { id, acao, alvo, ts, sig });

    const limite = Date.now() + this.esperaMs;
    try {
      while (Date.now() < limite) {
        await dormir(this.intervaloMs);
        const dados = await this.armazem.obter("pc-respostas", id);
        if (!dados) continue;
        await this.armazem.apagar("pc-respostas", id);
        if (!dados.ok) throw new Error(dados.mensagem || "O PC não conseguiu fazer isso.");
        return { feito: true, mensagem: dados.mensagem };
      }
    } finally {
      await this.armazem.apagar("pc-fila", id); // ordem não entregue não fica para depois
    }
    throw new Error("O PC não respondeu. Ele pode estar desligado ou com o programa Jarvis PC fechado.");
  }

  // ---------- Lado do PC ----------
  async #pedidoValido(texto, ts, sig) {
    const chave = await this.chave();
    const agora = Math.floor(Date.now() / 1000);
    if (!chave || !Number.isFinite(Number(ts)) || Math.abs(agora - Number(ts)) > VALIDADE_S) return null;
    return Computador.#iguais(sig, Computador.assinar(chave, texto)) ? chave : null;
  }

  // O PC pede a próxima ordem. Devolve a ordem, ou null se nada chegou no tempo de espera.
  // Lança "nao_autorizado" se a assinatura do pedido não confere.
  async esperarOrdem({ ts, sig }) {
    if (!(await this.#pedidoValido(`esperar|${ts}`, ts, sig))) throw new Error("nao_autorizado");
    await this.armazem.salvar("config", "pc-visto", { em: new Date().toISOString() });
    const limite = Date.now() + this.esperaPcMs;
    while (true) {
      const agora = Math.floor(Date.now() / 1000);
      const fila = (await this.armazem.listar("pc-fila")).sort((a, b) => a.ts - b.ts);
      for (const ordem of fila) {
        await this.armazem.apagar("pc-fila", ordem.id); // entregue uma vez só
        if (agora - ordem.ts <= 60) return ordem;
      }
      if (Date.now() + this.intervaloMs * 2 > limite) return null;
      await dormir(this.intervaloMs * 2);
    }
  }

  // O PC devolve o resultado de uma ordem.
  async receberResposta({ id, ok, mensagem, ts, sig }) {
    mensagem = String(mensagem ?? "").slice(0, 500);
    const texto = `${id}|${ok === true}|${mensagem}|${ts}`;
    if (!/^[a-f0-9]{16}$/.test(String(id)) || !(await this.#pedidoValido(texto, ts, sig))) throw new Error("nao_autorizado");
    await this.armazem.salvar("pc-respostas", id, { ok: ok === true, mensagem });
  }
}
