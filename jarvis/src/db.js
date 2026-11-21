// Armazenamento simples em arquivo JSON: notas, lembretes e finanças.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const VAZIO = { notas: [], lembretes: [], transacoes: [] };

// Data local (respeita a variável TZ) no formato AAAA-MM-DD.
export function hojeLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class Banco {
  constructor(arquivo) {
    this.arquivo = arquivo;
    this.dados = structuredClone(VAZIO);
    if (fs.existsSync(arquivo)) {
      this.dados = { ...structuredClone(VAZIO), ...JSON.parse(fs.readFileSync(arquivo, "utf8")) };
    }
  }

  salvar() {
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.dados, null, 2));
    fs.renameSync(tmp, this.arquivo); // escrita atômica
  }

  novoId() {
    return crypto.randomUUID().slice(0, 8);
  }

  // ---------- Notas ----------
  adicionarNota(texto) {
    const nota = { id: this.novoId(), texto, criadaEm: new Date().toISOString() };
    this.dados.notas.push(nota);
    this.salvar();
    return nota;
  }

  listarNotas() {
    return [...this.dados.notas].reverse();
  }

  apagarNota(id) {
    const antes = this.dados.notas.length;
    this.dados.notas = this.dados.notas.filter((n) => n.id !== id);
    this.salvar();
    return this.dados.notas.length < antes;
  }

  // ---------- Lembretes ----------
  adicionarLembrete(texto, quando) {
    const data = new Date(quando);
    if (Number.isNaN(data.getTime())) throw new Error(`Data inválida: ${quando}`);
    const lembrete = {
      id: this.novoId(),
      texto,
      quando: data.toISOString(),
      concluido: false,
      avisado: false,
    };
    this.dados.lembretes.push(lembrete);
    this.salvar();
    return lembrete;
  }

  listarLembretes({ incluirConcluidos = false } = {}) {
    return this.dados.lembretes
      .filter((l) => incluirConcluidos || !l.concluido)
      .sort((a, b) => a.quando.localeCompare(b.quando));
  }

  concluirLembrete(id) {
    const l = this.dados.lembretes.find((x) => x.id === id);
    if (!l) return false;
    l.concluido = true;
    this.salvar();
    return true;
  }

  // Lembretes que já venceram e ainda não foram avisados; marca como avisados.
  lembretesVencidos(agora = new Date()) {
    const vencidos = this.dados.lembretes.filter(
      (l) => !l.concluido && !l.avisado && new Date(l.quando) <= agora,
    );
    if (vencidos.length) {
      vencidos.forEach((l) => (l.avisado = true));
      this.salvar();
    }
    return vencidos;
  }

  // ---------- Finanças ----------
  adicionarTransacao({ tipo, valor, categoria, descricao, data }) {
    if (!["entrada", "saida"].includes(tipo)) throw new Error("tipo deve ser 'entrada' ou 'saida'");
    if (!(valor > 0)) throw new Error("valor deve ser maior que zero");
    const t = {
      id: this.novoId(),
      tipo,
      valor: Math.round(valor * 100) / 100,
      categoria: (categoria || "outros").toLowerCase(),
      descricao: descricao || "",
      data: data || hojeLocal(),
    };
    this.dados.transacoes.push(t);
    this.salvar();
    return t;
  }

  listarTransacoes({ mes, limite = 50 } = {}) {
    return this.dados.transacoes
      .filter((t) => !mes || t.data.startsWith(mes))
      .sort((a, b) => b.data.localeCompare(a.data))
      .slice(0, limite);
  }

  apagarTransacao(id) {
    const antes = this.dados.transacoes.length;
    this.dados.transacoes = this.dados.transacoes.filter((t) => t.id !== id);
    this.salvar();
    return this.dados.transacoes.length < antes;
  }

  // Resumo de um mês (AAAA-MM): totais e gastos por categoria.
  resumoFinanceiro(mes = hojeLocal().slice(0, 7)) {
    const doMes = this.dados.transacoes.filter((t) => t.data.startsWith(mes));
    const soma = (lista) => Math.round(lista.reduce((s, t) => s + t.valor, 0) * 100) / 100;
    const entradas = soma(doMes.filter((t) => t.tipo === "entrada"));
    const saidas = soma(doMes.filter((t) => t.tipo === "saida"));
    const porCategoria = {};
    for (const t of doMes.filter((t) => t.tipo === "saida")) {
      porCategoria[t.categoria] = Math.round(((porCategoria[t.categoria] || 0) + t.valor) * 100) / 100;
    }
    return {
      mes,
      entradas,
      saidas,
      saldo: Math.round((entradas - saidas) * 100) / 100,
      gastosPorCategoria: porCategoria,
      quantidade: doMes.length,
    };
  }
}
