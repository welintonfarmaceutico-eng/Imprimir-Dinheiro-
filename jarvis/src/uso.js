// Painel de gastos com a IA: a cada resposta, a API informa quantos tokens foram lidos e escritos;
// o Jarvis multiplica pela tabela de preços e guarda o custo estimado por dia e por quem usou
// (adulto, Modo Escola, fotos/documentos). É uma ESTIMATIVA: o valor oficial é o do console da Anthropic.
import { hojeLocal, inicioDoDia, horaLocal } from "./fuso.js";

// US$ por 1 milhão de tokens: entrada, saída, leitura de cache, escrita de cache.
const PRECOS = [
  [/^claude-opus-5-5/, { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 }],
  [/^claude-opus-(5|4)/, { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 }],
  [/^claude-sonnet-5/, { entrada: 2, saida: 10, cacheLeitura: 0.1, cacheEscrita: 2.5 }],
  [/^claude-sonnet/, { entrada: 3, saida: 15, cacheLeitura: 0.3, cacheEscrita: 3.75 }],
  [/^claude-haiku-5/, { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125 }],
  [/^claude-haiku/, { entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 1.25 }],
  [/^claude-(fable|mythos)-5-2/, { entrada: 8, saida: 40, cacheLeitura: 0.2, cacheEscrita: 10 }],
  [/^claude-(fable|mythos)/, { entrada: 10, saida: 50, cacheLeitura: 1, cacheEscrita: 12.5 }],
];
const PADRAO = { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 };
const BUSCA_USD = 0.01; // cada pesquisa na internet
export const QUEM = ["adulto", "escola", "fotos"];

const dolar = (env = process.env) => {
  const v = Number(String(env.JARVIS_DOLAR ?? "5.5").replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : 5.5;
};
const arred = (v, casas = 4) => Math.round(v * 10 ** casas) / 10 ** casas;

export function custoEmDolar(modelo, usage = {}) {
  const p = PRECOS.find(([re]) => re.test(String(modelo)))?.[1] || PADRAO;
  const m = 1_000_000;
  return (
    ((usage.input_tokens || 0) * p.entrada +
      (usage.output_tokens || 0) * p.saida +
      (usage.cache_read_input_tokens || 0) * p.cacheLeitura +
      (usage.cache_creation_input_tokens || 0) * p.cacheEscrita) / m +
    (usage.server_tool_use?.web_search_requests || 0) * BUSCA_USD
  );
}

export class Uso {
  constructor(armazem, { env = process.env } = {}) {
    this.armazem = armazem;
    this.env = env;
  }

  // Guarda o custo de uma resposta da IA.
  async registrar({ quem = "adulto", modelo, usage }, agora = new Date()) {
    if (!usage) return;
    if (!QUEM.includes(quem)) quem = "adulto";
    const dia = hojeLocal(agora);
    const id = `${dia}-${quem}`;
    const atual = (await this.armazem.obter("uso-ia", id)) || { dia, quem, usd: 0, pedidos: 0, entrada: 0, saida: 0 };
    atual.usd = arred(atual.usd + custoEmDolar(modelo, usage), 6);
    atual.pedidos += 1;
    atual.entrada += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    atual.saida += usage.output_tokens || 0;
    await this.armazem.salvar("uso-ia", id, atual);
  }

  async limite() {
    return (await this.armazem.obter("config", "uso-limite"))?.mensalReais ?? null;
  }

  async definirLimite(mensalReais) {
    const v = Number(String(mensalReais ?? "").replace(",", "."));
    if (mensalReais === null || mensalReais === "" || v === 0) {
      await this.armazem.apagar("config", "uso-limite");
      return { limite: null };
    }
    if (!Number.isFinite(v) || v < 0) throw new Error("Limite inválido.");
    await this.armazem.salvar("config", "uso-limite", { mensalReais: arred(v, 2) });
    return { limite: arred(v, 2) };
  }

  // Resumo para o painel: hoje, mês e últimos 7 dias, em reais (estimativa).
  async resumo(agora = new Date()) {
    const cotacao = dolar(this.env);
    const reais = (usd) => arred(usd * cotacao, 2);
    const todos = await this.armazem.listar("uso-ia");
    const hoje = hojeLocal(agora);
    const mes = hoje.slice(0, 7);
    const soma = (lista) => {
      const r = { total: 0, adulto: 0, escola: 0, fotos: 0, pedidos: 0 };
      for (const u of lista) { r[u.quem] = (r[u.quem] || 0) + u.usd; r.total += u.usd; r.pedidos += u.pedidos; }
      return { total: reais(r.total), adulto: reais(r.adulto), escola: reais(r.escola), fotos: reais(r.fotos), pedidos: r.pedidos };
    };
    const ultimos7 = [];
    for (let i = 6; i >= 0; i--) {
      const dia = hojeLocal(inicioDoDia(agora, -i));
      ultimos7.push({ dia, total: soma(todos.filter((u) => u.dia === dia)).total });
    }
    const doMes = soma(todos.filter((u) => u.dia.startsWith(mes)));
    // Projeção simples do mês: média por dia até hoje × dias do mês.
    const diaDoMes = Number(hoje.slice(8, 10));
    const diasNoMes = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
    const limite = await this.limite();
    return {
      hoje: soma(todos.filter((u) => u.dia === hoje)),
      mes: doMes,
      projecaoMes: arred((doMes.total / Math.max(1, diaDoMes)) * diasNoMes, 2),
      ultimos7,
      limite,
      usoDoLimite: limite ? Math.round((doMes.total / limite) * 100) : null,
      cotacaoDolar: cotacao,
      estimativa: true,
    };
  }

  // Chamado de minuto em minuto: avisa uma vez ao chegar em 80% e em 100% do limite do mês.
  async avisarLimite(canais, agora = new Date()) {
    const limite = await this.limite();
    if (!limite || horaLocal(agora) < 8) return { avisos: 0 };
    const { mes } = await this.resumo(agora);
    const pct = (mes.total / limite) * 100;
    const marco = pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
    if (!marco) return { avisos: 0 };
    const id = `${hojeLocal(agora).slice(0, 7)}-${marco}`;
    if (await this.armazem.obter("uso-avisos", id)) return { avisos: 0 };
    const real = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const texto = marco === 100
      ? `⚠️ Jarvis: os gastos com a IA chegaram ao limite do mês (${real(mes.total)} de ${real(limite)}, estimativa). Você pode aumentar o limite em Ajustes.`
      : `📊 Jarvis: os gastos com a IA já estão em ${Math.round(pct)}% do limite do mês (${real(mes.total)} de ${real(limite)}, estimativa).`;
    let avisos = 0;
    for (const c of canais) {
      if (!c?.configurado) continue;
      try { await c.enviar(texto); avisos++; } catch (e) { console.error("Aviso de gastos:", e.message); }
    }
    await this.armazem.salvar("uso-avisos", id, { em: agora.toISOString() });
    return { avisos };
  }
}
