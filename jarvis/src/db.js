// Regras de notas, lembretes e finanças, sobre qualquer armazém (arquivo ou Netlify Blobs).
import crypto from "node:crypto";

import { hojeLocal, lerData } from "./fuso.js";

export { hojeLocal }; // data local (no fuso do usuário) no formato AAAA-MM-DD

const arred = (v) => Math.round(v * 100) / 100;

export class Banco {
  constructor(armazem) {
    this.armazem = armazem;
  }

  novoId() {
    return crypto.randomUUID().slice(0, 8);
  }

  // ---------- Notas ----------
  async adicionarNota(texto) {
    const nota = { id: this.novoId(), texto, criadaEm: new Date().toISOString() };
    await this.armazem.salvar("notas", nota.id, nota);
    return nota;
  }

  async listarNotas() {
    const notas = await this.armazem.listar("notas");
    return notas.sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
  }

  async apagarNota(id) {
    return this.armazem.apagar("notas", id);
  }

  // ---------- Lembretes ----------
  async adicionarLembrete(texto, quando) {
    const data = lerData(quando);
    if (Number.isNaN(data.getTime())) throw new Error(`Data inválida: ${quando}`);
    const lembrete = { id: this.novoId(), texto, quando: data.toISOString(), concluido: false, avisado: false };
    await this.armazem.salvar("lembretes", lembrete.id, lembrete);
    return lembrete;
  }

  async listarLembretes({ incluirConcluidos = false } = {}) {
    const todos = await this.armazem.listar("lembretes");
    return todos
      .filter((l) => incluirConcluidos || !l.concluido)
      .sort((a, b) => a.quando.localeCompare(b.quando));
  }

  async concluirLembrete(id) {
    const l = await this.armazem.obter("lembretes", id);
    if (!l) return false;
    await this.armazem.salvar("lembretes", id, { ...l, concluido: true });
    return true;
  }

  // Lembretes que já venceram e ainda não foram avisados; marca como avisados.
  async lembretesVencidos(agora = new Date()) {
    const vencidos = (await this.armazem.listar("lembretes")).filter(
      (l) => !l.concluido && !l.avisado && new Date(l.quando) <= agora,
    );
    await Promise.all(vencidos.map((l) => this.armazem.salvar("lembretes", l.id, { ...l, avisado: true })));
    return vencidos;
  }

  // ---------- Finanças ----------
  async adicionarTransacao({ tipo, valor, categoria, descricao, data }) {
    if (!["entrada", "saida"].includes(tipo)) throw new Error("tipo deve ser 'entrada' ou 'saida'");
    if (!(valor > 0)) throw new Error("valor deve ser maior que zero");
    if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("data deve estar no formato AAAA-MM-DD");
    const t = {
      id: this.novoId(),
      tipo,
      valor: arred(valor),
      categoria: (categoria || "outros").toLowerCase(),
      descricao: descricao || "",
      data: data || hojeLocal(),
      criadaEm: new Date().toISOString(),
    };
    await this.armazem.salvar("transacoes", t.id, t);
    return t;
  }

  async listarTransacoes({ mes, limite = 50 } = {}) {
    const todas = await this.armazem.listar("transacoes");
    return todas
      .filter((t) => !mes || t.data.startsWith(mes))
      .sort((a, b) => b.data.localeCompare(a.data) || (b.criadaEm || "").localeCompare(a.criadaEm || ""))
      .slice(0, limite);
  }

  async apagarTransacao(id) {
    return this.armazem.apagar("transacoes", id);
  }

  // Resumo de um mês (AAAA-MM): totais e gastos por categoria.
  async resumoFinanceiro(mes = hojeLocal().slice(0, 7)) {
    const doMes = (await this.armazem.listar("transacoes")).filter((t) => t.data.startsWith(mes));
    const soma = (lista) => arred(lista.reduce((s, t) => s + t.valor, 0));
    const entradas = soma(doMes.filter((t) => t.tipo === "entrada"));
    const saidas = soma(doMes.filter((t) => t.tipo === "saida"));
    const gastosPorCategoria = {};
    for (const t of doMes.filter((t) => t.tipo === "saida")) {
      gastosPorCategoria[t.categoria] = arred((gastosPorCategoria[t.categoria] || 0) + t.valor);
    }
    return { mes, entradas, saidas, saldo: arred(entradas - saidas), gastosPorCategoria, quantidade: doMes.length };
  }

  // ---------- Histórico das conversas ----------
  async obterConversa(id) {
    return (await this.armazem.obter("conversas", id))?.mensagens ?? [];
  }
  async salvarConversa(id, mensagens) {
    await this.armazem.salvar("conversas", id, { mensagens, atualizadaEm: new Date().toISOString() });
  }
  async apagarConversa(id) {
    return this.armazem.apagar("conversas", id);
  }
}
