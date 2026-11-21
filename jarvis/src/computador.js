// Ponte entre o Jarvis e o programa instalado no PC do usuário.
// As ordens vão pelo ntfy.sh (serviço gratuito de mensagens): o PC recebe na hora, sem ficar consultando o Netlify.
// Toda ordem e toda resposta são assinadas com uma chave secreta (HMAC-SHA256) que só o Jarvis e o PC conhecem.
import crypto from "node:crypto";
import { MODELO_PC } from "./jarvis-pc-modelo.js";

const ACOES = ["abrir_programa", "abrir_site", "volume", "ping"];
const ESPERA_MS = 9000; // quanto tempo espera o PC responder

export class Computador {
  constructor(armazem, { fetch: f = (...a) => globalThis.fetch(...a), servidor = process.env.JARVIS_PC_SERVIDOR || "https://ntfy.sh", esperaMs = ESPERA_MS } = {}) {
    this.armazem = armazem;
    this.fetch = f;
    this.servidor = servidor.replace(/\/+$/, "");
    this.esperaMs = esperaMs;
  }

  async chave({ criar = false } = {}) {
    const conf = await this.armazem.obter("config", "pc");
    if (conf?.chave || !criar) return conf?.chave ?? null;
    const chave = crypto.randomBytes(24).toString("hex");
    await this.armazem.salvar("config", "pc", { chave, criadoEm: new Date().toISOString() });
    return chave;
  }

  static topicos(chave) {
    const h = (s) => crypto.createHash("sha256").update(chave + s).digest("hex").slice(0, 30);
    return { comandos: `jv${h(":cmd")}`, respostas: `jv${h(":resp")}` };
  }

  static assinar(chave, texto) {
    return crypto.createHmac("sha256", chave).update(texto, "utf8").digest("hex");
  }

  async configurado() {
    return Boolean(await this.chave());
  }

  async desconectar() {
    await this.armazem.apagar("config", "pc");
  }

  // Script do PowerShell já com a chave e os canais deste Jarvis (com BOM: o PowerShell 5 lê acentos certo).
  async instalador() {
    const chave = await this.chave({ criar: true });
    const { comandos, respostas } = Computador.topicos(chave);
    const script = MODELO_PC
      .replaceAll("__CHAVE__", chave)
      .replaceAll("__SERVIDOR__", this.servidor)
      .replaceAll("__TOPICO_COMANDOS__", comandos)
      .replaceAll("__TOPICO_RESPOSTAS__", respostas);
    return "﻿" + script.replace(/\r?\n/g, "\r\n");
  }

  // Manda uma ordem ao PC e espera a resposta.
  async executar(acao, alvo = "") {
    if (!ACOES.includes(acao)) throw new Error(`Ação não permitida: ${acao}`);
    const chave = await this.chave();
    if (!chave) throw new Error('O computador ainda não foi conectado. Vá em Ajustes (⚙), na parte "Computador", e baixe o programa do PC.');
    const { comandos, respostas } = Computador.topicos(chave);
    const id = crypto.randomBytes(8).toString("hex");
    const ts = Math.floor(Date.now() / 1000);
    alvo = String(alvo ?? "").slice(0, 300);
    const sig = Computador.assinar(chave, `${id}|${acao}|${alvo}|${ts}`);

    const envio = await this.fetch(`${this.servidor}/${comandos}`, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: JSON.stringify({ id, acao, alvo, ts, sig }),
    });
    if (!envio.ok) throw new Error(`Não consegui mandar a ordem ao PC (${envio.status}).`);

    // Procura a resposta assinada do PC.
    const limite = Date.now() + this.esperaMs;
    while (Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 900));
      const resp = await this.fetch(`${this.servidor}/${respostas}/json?poll=1&since=${ts - 2}`);
      if (!resp.ok) continue;
      for (const linha of (await resp.text()).split("\n")) {
        if (!linha.trim()) continue;
        let evento, dados;
        try { evento = JSON.parse(linha); dados = JSON.parse(evento.message); } catch { continue; }
        if (evento.event !== "message" || dados?.id !== id) continue;
        const ok = dados.ok === true;
        const esperado = Computador.assinar(chave, `${id}|${ok}|${dados.mensagem}`);
        if (dados.sig !== esperado) continue; // resposta falsa: ignora
        if (!ok) throw new Error(dados.mensagem || "O PC não conseguiu fazer isso.");
        return { feito: true, mensagem: dados.mensagem };
      }
    }
    throw new Error("O PC não respondeu. Ele pode estar desligado ou com o programa Jarvis PC fechado.");
  }
}
