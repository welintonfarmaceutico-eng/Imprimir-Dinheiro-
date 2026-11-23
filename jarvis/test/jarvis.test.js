import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ArmazemArquivo, ArmazemBlobs } from "../src/armazem.js";
import { Banco } from "../src/db.js";
import { criarFerramentas } from "../src/ferramentas.js";
import { Cerebro } from "../src/cerebro.js";
import { criarJarvis } from "../src/rotas.js";

process.env.ANTHROPIC_API_KEY ||= "teste";
const arquivoTemp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-")), "db.json");
const novoBanco = () => new Banco(new ArmazemArquivo(arquivoTemp()));

// Imita o Netlify Blobs em memória, com a mesma interface usada pelo ArmazemBlobs.
function blobsFalso() {
  const mapa = new Map();
  return () => ({
    async list({ prefix }) { return { blobs: [...mapa.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
    async get(k) { return mapa.has(k) ? structuredClone(mapa.get(k)) : null; },
    async setJSON(k, v) { mapa.set(k, structuredClone(v)); },
    async delete(k) { mapa.delete(k); },
  });
}

// Cliente da API simulado: devolve as respostas na ordem e guarda os pedidos.
function clienteFalso(respostas) {
  const pedidos = [];
  // Imita client.beta.messages.stream(): manda os textos para quem escuta "text" e devolve a mensagem final.
  const stream = (p) => {
    pedidos.push(structuredClone(p));
    const resposta = respostas.shift();
    const ouvintes = [];
    return {
      on(evento, cb) { if (evento === "text") ouvintes.push(cb); return this; },
      async finalMessage() {
        if (resposta instanceof Error) throw resposta;
        for (const b of resposta.content) if (b.type === "text") ouvintes.forEach((cb) => cb(b.text));
        return resposta;
      },
    };
  };
  return { pedidos, beta: { messages: { stream } } };
}

for (const [nome, criar] of [
  ["arquivo", () => new ArmazemArquivo(arquivoTemp())],
  ["Netlify Blobs", () => new ArmazemBlobs(blobsFalso())],
]) {
  test(`finanças: registra e resume o mês (${nome})`, async () => {
    const b = new Banco(criar());
    await b.adicionarTransacao({ tipo: "entrada", valor: 2000, categoria: "Salário", data: "2026-11-05" });
    await b.adicionarTransacao({ tipo: "saida", valor: 35.5, categoria: "alimentação", data: "2026-11-10" });
    await b.adicionarTransacao({ tipo: "saida", valor: 14.5, categoria: "alimentação", data: "2026-11-11" });
    await b.adicionarTransacao({ tipo: "saida", valor: 99, categoria: "lazer", data: "2026-10-30" });
    const r = await b.resumoFinanceiro("2026-11");
    assert.equal(r.entradas, 2000);
    assert.equal(r.saidas, 50);
    assert.equal(r.saldo, 1950);
    assert.deepEqual(r.gastosPorCategoria, { "alimentação": 50 });
    await assert.rejects(b.adicionarTransacao({ tipo: "saida", valor: -1 }));
    const [ultima] = await b.listarTransacoes();
    assert.equal(ultima.data, "2026-11-11");
    assert.equal(await b.apagarTransacao(ultima.id), true);
    assert.equal(await b.apagarTransacao(ultima.id), false);
  });

  test(`lembretes: avisa só uma vez quando vence (${nome})`, async () => {
    const b = new Banco(criar());
    await b.adicionarLembrete("passado", "2020-01-01T10:00:00-03:00");
    const futuro = await b.adicionarLembrete("futuro", "2099-01-01T10:00:00-03:00");
    assert.deepEqual((await b.lembretesVencidos()).map((l) => l.texto), ["passado"]);
    assert.equal((await b.lembretesVencidos()).length, 0);
    await assert.rejects(b.adicionarLembrete("x", "amanhã"));
    await b.concluirLembrete(futuro.id);
    assert.equal((await b.listarLembretes()).length, 1);
  });
}

test("dados persistem no arquivo", async () => {
  const arquivo = arquivoTemp();
  await new Banco(new ArmazemArquivo(arquivo)).adicionarNota("comprar pão");
  const [nota] = await new Banco(new ArmazemArquivo(arquivo)).listarNotas();
  assert.equal(nota.texto, "comprar pão");
});

test("ferramentas têm esquema estrito válido", () => {
  const { definicoes } = criarFerramentas(novoBanco());
  for (const d of definicoes) {
    assert.equal(d.strict, true);
    assert.equal(d.input_schema.additionalProperties, false);
    assert.deepEqual(d.input_schema.required, Object.keys(d.input_schema.properties));
  }
});

test("cérebro: executa ferramenta e mantém histórico intacto entre perguntas", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  cerebro.cliente = clienteFalso([
    {
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "abc" },
        { type: "tool_use", id: "t1", name: "registrar_transacao", input: { tipo: "saida", valor: 30, categoria: "alimentação", descricao: "almoço", data: "" } },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Anotado: R$ 30,00 no almoço." }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Foi R$ 30,00." }] },
  ]);

  const r = await cerebro.conversar("c1", "gastei 30 no almoço");
  assert.equal(r.texto, "Anotado: R$ 30,00 no almoço.");
  assert.deepEqual(r.acoes, ["registrar_transacao"]);
  assert.equal((await banco.resumoFinanceiro()).saidas, 30);

  const { pedidos } = cerebro.cliente;
  assert.equal(pedidos[1].messages[1].content[0].signature, "abc");
  assert.equal(pedidos[1].messages[2].content[0].type, "tool_result");
  assert.equal(pedidos[0].model, "claude-opus-5-5");
  assert.equal(pedidos[0].fallbacks, "default");
  assert.deepEqual(pedidos[0].thinking, { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
  assert.ok(pedidos[0].betas.includes("thinking-binding-controls-2026-08-01"));

  // Segunda pergunta: o histórico salvo volta idêntico, com a nova pergunta no fim.
  await cerebro.conversar("c1", "quanto foi?");
  assert.equal(pedidos[2].messages.length, 5);
  assert.deepEqual(pedidos[2].messages.slice(0, 4), [...pedidos[1].messages, { role: "assistant", content: pedidos[2].messages[3].content }]);
  assert.equal(pedidos[2].messages[1].content[0].signature, "abc");
});

test("cérebro: recusa e erro não gravam histórico", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  cerebro.cliente = clienteFalso([{ stop_reason: "refusal", content: [] }]);
  const r = await cerebro.conversar("c2", "algo");
  assert.match(r.texto, /não posso/);
  assert.equal((await banco.obterConversa("c2")).length, 0);

  cerebro.cliente = clienteFalso([new Error("rede")]);
  await assert.rejects(cerebro.conversar("c2", "oi"));
  assert.equal((await banco.obterConversa("c2")).length, 0);
});

test("rotas: senha, painel e validação", async () => {
  const tratar = criarJarvis(new ArmazemBlobs(blobsFalso()), { senha: "segredo" });
  const req = (metodo, caminho, { senha, corpo } = {}) =>
    tratar(new Request(`http://x${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json", ...(senha ? { "x-jarvis-senha": senha } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    }));

  assert.equal((await req("GET", "/api/status")).status, 200);
  assert.equal((await req("GET", "/api/painel")).status, 401);
  assert.equal((await req("GET", "/api/painel", { senha: "errada" })).status, 401);
  const painel = await (await req("GET", "/api/painel", { senha: "segredo" })).json();
  assert.equal(painel.financas.saldo, 0);
  assert.equal((await req("POST", "/api/conversar", { senha: "segredo", corpo: { conversa: "../x", texto: "oi" } })).status, 400);
  assert.equal((await req("GET", "/api/nada", { senha: "segredo" })).status, 404);
});

// ---------- Google Agenda (com Google simulado) ----------
import { GoogleAgenda } from "../src/google.js";

function googleFalso() {
  const chamadas = [];
  const eventos = [];
  let refreshValido = true;
  const resposta = (status, corpo) => new Response(corpo === null ? null : JSON.stringify(corpo), { status });
  const f = async (url, opcoes = {}) => {
    const u = new URL(url);
    chamadas.push({ url: u, opcoes });
    if (u.hostname === "oauth2.googleapis.com") {
      const campos = new URLSearchParams(opcoes.body);
      if (campos.get("grant_type") === "authorization_code") {
        return resposta(200, { access_token: "acesso-1", expires_in: 3600, refresh_token: "refresh-1" });
      }
      if (!refreshValido) return resposta(400, { error: "invalid_grant" });
      return resposta(200, { access_token: "acesso-2", expires_in: 3600 });
    }
    if (opcoes.method === "POST") {
      const e = JSON.parse(opcoes.body);
      const criado = { id: `ev${eventos.length + 1}`, summary: e.summary, start: e.start, end: e.end, htmlLink: "https://cal/x" };
      eventos.push(criado);
      return resposta(200, criado);
    }
    if (opcoes.method === "DELETE") return resposta(204, null);
    return resposta(200, { items: eventos });
  };
  return { f, chamadas, invalidarRefresh: () => (refreshValido = false) };
}

test("google: conecta com state de uso único e usa a agenda", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const g = googleFalso();
  const agenda = new GoogleAgenda(armazem, { fetch: g.f, env: { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "segredo" } });
  assert.equal(agenda.configurado, true);
  assert.equal(await agenda.conectado(), false);
  await assert.rejects(agenda.listarEventos(new Date(), new Date()), /não conectado/);

  const link = new URL(await agenda.linkDeConexao("https://maijarvis.netlify.app/api/google/retorno"));
  assert.equal(link.searchParams.get("access_type"), "offline");
  assert.equal(link.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events");
  const estado = link.searchParams.get("state");

  await assert.rejects(agenda.concluirConexao("codigo", "0".repeat(32)), /inválido/);
  await agenda.concluirConexao("codigo", estado);
  assert.equal(await agenda.conectado(), true);
  await assert.rejects(agenda.concluirConexao("codigo", estado), /inválido/); // não reaproveita o state

  const criado = await agenda.criarEvento({ titulo: "Dentista", inicio: "2026-11-27T14:00:00-03:00", fim: "2026-11-27T15:00:00-03:00", local: "", descricao: "" });
  assert.equal(criado.titulo, "Dentista");
  await assert.rejects(agenda.criarEvento({ titulo: "x", inicio: "2026-11-27T15:00:00-03:00", fim: "2026-11-27T14:00:00-03:00" }), /depois do início/);
  const lista = await agenda.listarEventos("2026-11-27T00:00:00-03:00", "2026-11-28T00:00:00-03:00");
  assert.deepEqual(lista.map((e) => e.titulo), ["Dentista"]);
  assert.equal(g.chamadas.at(-1).opcoes.headers.authorization, "Bearer acesso-1");
  assert.deepEqual(await agenda.apagarEvento("ev1"), { apagado: true });

  // Token de acesso vencido: renova com o refresh token; se o Google revogar, desconecta.
  agenda.tokenAcesso = null;
  await agenda.listarEventos(new Date(), new Date());
  assert.equal(g.chamadas.at(-1).opcoes.headers.authorization, "Bearer acesso-2");
  agenda.tokenAcesso = null;
  g.invalidarRefresh();
  await assert.rejects(agenda.listarEventos(new Date(), new Date()), /expirou/);
  assert.equal(await agenda.conectado(), false);
});

test("google: ferramentas da agenda entram para o Jarvis", () => {
  const banco = novoBanco();
  const sem = criarFerramentas(banco).definicoes.map((d) => d.name);
  const com = criarFerramentas(banco, { listarEventos() {}, criarEvento() {}, apagarEvento() {} }).definicoes.map((d) => d.name);
  assert.ok(!sem.includes("agenda_criar_evento"));
  assert.deepEqual(com.filter((n) => n.startsWith("agenda_")), ["agenda_listar_eventos", "agenda_criar_evento", "agenda_apagar_evento"]);
});

test("ferramentas de apagar devolvem o resultado de verdade", async () => {
  const banco = novoBanco();
  const f = criarFerramentas(banco);
  const nota = await banco.adicionarNota("x");
  assert.deepEqual(await f.executar("apagar_nota", { id: nota.id }), { apagada: true });
  assert.deepEqual(await f.executar("apagar_nota", { id: nota.id }), { apagada: false });
});

// ---------- WhatsApp (CallMeBot simulado) ----------
import { WhatsApp, enviarLembretesVencidos } from "../src/whatsapp.js";

function callmebotFalso(resposta = "Message queued. You will receive it in a few seconds.", status = 200) {
  const enviados = [];
  const f = async (url) => {
    const u = new URL(url);
    enviados.push({ telefone: u.searchParams.get("phone"), texto: u.searchParams.get("text"), apikey: u.searchParams.get("apikey") });
    return new Response(resposta, { status });
  };
  return { f, enviados };
}

test("whatsapp: envia lembrete vencido uma vez só e ignora antigos e futuros", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const banco = new Banco(armazem);
  const cb = callmebotFalso();
  const zap = new WhatsApp({ fetch: cb.f, env: { WHATSAPP_TELEFONE: "+55 (31) 99999-8888", WHATSAPP_APIKEY: " 123456 " } });
  const agora = new Date("2026-11-21T12:00:00Z");
  await banco.adicionarLembrete("beber água", "2026-11-21T11:59:00Z");   // acabou de vencer
  await banco.adicionarLembrete("antigo", "2026-11-21T09:00:00Z");       // venceu há horas
  await banco.adicionarLembrete("futuro", "2026-11-21T13:00:00Z");

  assert.deepEqual(await enviarLembretesVencidos(banco, armazem, zap, agora), { enviados: 1 });
  assert.deepEqual(cb.enviados, [{ telefone: "+5531999998888", texto: "⏰ Lembrete do Jarvis: beber água", apikey: "123456" }]);
  assert.deepEqual(await enviarLembretesVencidos(banco, armazem, zap, agora), { enviados: 0 }); // não repete

  // O aviso do navegador continua funcionando, separado do WhatsApp.
  assert.equal((await banco.lembretesVencidos(agora)).length, 2);
});

test("whatsapp: erro do serviço não marca como enviado; sem configuração não faz nada", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const banco = new Banco(armazem);
  const agora = new Date("2026-11-21T12:00:00Z");
  await banco.adicionarLembrete("x", "2026-11-21T11:59:00Z");
  const ruim = new WhatsApp({ fetch: callmebotFalso("APIKey is invalid").f, env: { WHATSAPP_TELEFONE: "+55", WHATSAPP_APIKEY: "1" } });
  assert.deepEqual(await enviarLembretesVencidos(banco, armazem, ruim, agora), { enviados: 0 });
  const bom = new WhatsApp({ fetch: callmebotFalso().f, env: { WHATSAPP_TELEFONE: "+55", WHATSAPP_APIKEY: "1" } });
  assert.deepEqual(await enviarLembretesVencidos(banco, armazem, bom, agora), { enviados: 1 }); // tenta de novo depois
  assert.deepEqual(await enviarLembretesVencidos(banco, armazem, new WhatsApp({ env: {} }), agora), { enviados: 0 });
});

test("whatsapp: ferramenta só aparece quando configurado", () => {
  const banco = novoBanco();
  const sem = criarFerramentas(banco, null, new WhatsApp({ env: {} })).definicoes.map((d) => d.name);
  const com = criarFerramentas(banco, null, new WhatsApp({ env: { WHATSAPP_TELEFONE: "+55", WHATSAPP_APIKEY: "1" } })).definicoes.map((d) => d.name);
  assert.ok(!sem.includes("enviar_whatsapp"));
  assert.ok(com.includes("enviar_whatsapp"));
});

// ---------- Mensagens de erro (crédito, limite de gasto) ----------
import Anthropic from "@anthropic-ai/sdk";
import { explicarErro } from "../src/rotas.js";

test("erros: crédito acabado e limite de gasto viram mensagens claras", () => {
  const gerar = (status, corpo) => Anthropic.APIError.generate(status, { type: "error", error: corpo }, undefined, new Headers());

  const pagamento = explicarErro(gerar(402, { type: "billing_error", message: "x" }));
  assert.equal(pagamento.credito, true);
  assert.match(pagamento.mensagem, /créditos da Anthropic acabaram/);

  const saldo = explicarErro(gerar(400, { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." }));
  assert.equal(saldo.credito, true);
  assert.match(saldo.mensagem, /créditos/);

  const teto = explicarErro(gerar(429, { type: "rate_limit_error", message: "m", details: { error_code: "enforced_spend_limit_reached" } }));
  assert.equal(teto.credito, true);
  assert.match(teto.mensagem, /limite de gasto/);

  const rapido = explicarErro(gerar(429, { type: "rate_limit_error", message: "m" }));
  assert.ok(!rapido.credito);
  assert.match(rapido.mensagem, /Muitas perguntas/);

  assert.match(explicarErro(gerar(529, { type: "overloaded_error", message: "m" })).mensagem, /ocupado/);
  assert.match(explicarErro(gerar(400, { type: "invalid_request_error", message: "outra coisa" })).mensagem, /problema para pensar/);
});

// ---------- Tempo real, fallback e botões rápidos ----------
import { limparFallback } from "../src/cerebro.js";

test("cérebro: texto chega em pedaços enquanto a resposta é gerada", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  cerebro.cliente = clienteFalso([{ stop_reason: "end_turn", content: [{ type: "text", text: "Olá! " }, { type: "text", text: "Tudo certo." }] }]);
  const pedacos = [];
  const r = await cerebro.conversar("c3", "oi", (d) => pedacos.push(d));
  assert.deepEqual(pedacos, ["Olá! ", "Tudo certo."]);
  assert.equal(r.texto, "Olá! Tudo certo.");
  assert.equal(cerebro.cliente.pedidos[0].tools[0].max_uses, 2);
});

test("fallback: tira raciocínio e chamadas antes da troca de modelo, mantém o resto", () => {
  const conteudo = [
    { type: "thinking", thinking: "", signature: "a" },
    { type: "text", text: "Vou " },
    { type: "tool_use", id: "t0", name: "x", input: {} },
    { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
    { type: "server_tool_use", id: "s2", name: "web_search", input: {} },
    { type: "fallback", from: { model: "a" }, to: { model: "b" } },
    { type: "thinking", thinking: "", signature: "b" },
    { type: "tool_use", id: "t1", name: "y", input: {} },
  ];
  const limpo = limparFallback(conteudo).map((b) => b.type + (b.id ? ":" + b.id : ""));
  assert.deepEqual(limpo, ["text", "server_tool_use:s1", "web_search_tool_result", "fallback", "thinking", "tool_use:t1"]);
  const semFallback = [{ type: "thinking" }, { type: "text" }];
  assert.equal(limparFallback(semFallback), semFallback);
});

test("rotas: botões rápidos salvam sem IA e validam os dados", async () => {
  const tratar = criarJarvis(new ArmazemBlobs(blobsFalso()), { senha: "" });
  const post = (caminho, corpo) => tratar(new Request(`http://x${caminho}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }));
  assert.equal((await post("/api/transacoes", { tipo: "saida", valor: "35,50", categoria: "alimentação", descricao: "almoço" })).status, 200);
  assert.equal((await post("/api/transacoes", { tipo: "saida", valor: "abc" })).status, 400);
  assert.equal((await post("/api/notas", { texto: "comprar pão" })).status, 200);
  assert.equal((await post("/api/notas", { texto: " " })).status, 400);
  assert.equal((await post("/api/lembretes", { texto: "x", quando: "2099-01-01T10:00:00-03:00" })).status, 200);
  assert.equal((await post("/api/lembretes", { texto: "x", quando: "amanhã" })).status, 400);
  const painel = await (await tratar(new Request("http://x/api/painel"))).json();
  assert.equal(painel.financas.saidas, 35.5);
  assert.equal(painel.notas.length, 1);
  assert.equal(painel.lembretes.length, 1);
});

test("rotas: resposta ao vivo chega em eventos e termina com o texto completo", async () => {
  const cliente = clienteFalso([{ stop_reason: "end_turn", content: [{ type: "text", text: "Bom " }, { type: "text", text: "dia!" }] }]);
  const tratar = criarJarvis(new ArmazemBlobs(blobsFalso()), { senha: "", cliente });
  const resp = await tratar(new Request("http://x/api/conversar/ao-vivo", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversa: "c9", texto: "oi" }),
  }));
  assert.match(resp.headers.get("content-type"), /text\/event-stream/);
  const eventos = (await resp.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")));
  assert.deepEqual(eventos.map((e) => e.tipo), ["texto", "texto", "fim"]);
  assert.equal(eventos.at(-1).texto, "Bom dia!");
});

test("cérebro: texto antes e depois de uma ferramenta vem separado por quebra de linha", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  cerebro.cliente = clienteFalso([
    { stop_reason: "tool_use", content: [{ type: "text", text: "Vou anotar." }, { type: "tool_use", id: "t1", name: "salvar_nota", input: { texto: "pão" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Pronto, anotado." }] },
  ]);
  const pedacos = [];
  const r = await cerebro.conversar("c4", "anota pão", (d) => pedacos.push(d));
  assert.equal(pedacos.join(""), "Vou anotar.\nPronto, anotado.");
  assert.equal(r.texto, "Pronto, anotado.");
  assert.equal((await banco.listarNotas())[0].texto, "pão");
});

// ---------- Computador (Jarvis PC), com um "PC" simulado que fala com as rotas ----------
import { Computador } from "../src/computador.js";
import cryptoNode from "node:crypto";

const hmac = (k, t) => cryptoNode.createHmac("sha256", k).update(t, "utf8").digest("hex");

// Um "PC" que segue as mesmas regras do script do Windows: pede ordem em /api/pc/esperar,
// confere a assinatura, executa e devolve a resposta assinada em /api/pc/resposta.
function pcSimulado(tratar, chave, { falsificar = false, falhar = null } = {}) {
  const executados = [];
  let ligado = true;
  const ciclo = async () => {
    while (ligado) {
      const ts = Math.floor(Date.now() / 1000);
      const r = await tratar(new Request(`http://x/api/pc/esperar?ts=${ts}&sig=${hmac(chave, `esperar|${ts}`)}`));
      if (r.status !== 200) continue;
      const c = await r.json();
      if (hmac(chave, `${c.id}|${c.acao}|${c.alvo}|${c.ts}`) !== c.sig) continue;
      executados.push([c.acao, c.alvo]);
      const ok = !falhar;
      const mensagem = falhar || `feito: ${c.acao} ${c.alvo}`;
      const tsr = Math.floor(Date.now() / 1000);
      const sig = falsificar ? "0".repeat(64) : hmac(chave, `${c.id}|${ok}|${mensagem}|${tsr}`);
      await tratar(new Request("http://x/api/pc/resposta", { method: "POST", body: JSON.stringify({ id: c.id, ok, mensagem, ts: tsr, sig }) }));
    }
  };
  const rodando = ciclo();
  return { executados, desligar: async () => { ligado = false; await rodando; } };
}

const opcoesPcRapido = { esperaPcMs: 300, intervaloMs: 20, esperaMs: 1500 };

test("pc: instalador cria a chave e preenche o script do Windows com o endereço do Jarvis", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const pc = new Computador(armazem);
  assert.equal(await pc.configurado(), false);
  await assert.rejects(pc.executar("volume", "subir"), /ainda não foi conectado/);
  const script = await pc.instalador("https://jarvis.exemplo.workers.dev/");
  const chave = await pc.chave();
  assert.ok(script.startsWith("\ufeff"), "precisa do BOM para o PowerShell 5 ler acentos");
  assert.ok(script.includes(`$Chave = '${chave}'`));
  assert.ok(script.includes("$Servidor = 'https://jarvis.exemplo.workers.dev'"));
  assert.ok(!/__[A-Z_]+__/.test(script), "não pode sobrar marcador");
  assert.ok(script.includes("\r\n"));
  await pc.instalador("https://x");
  assert.equal(await pc.chave(), chave, "baixar de novo mantém a mesma chave");
});

test("pc: ordem assinada chega ao PC pelas rotas e a resposta assinada volta", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const tratar = criarJarvis(armazem, { senha: "segredo", computadorOpcoes: opcoesPcRapido });
  const pc = new Computador(armazem, opcoesPcRapido);
  await pc.instalador("http://x");
  const sim = pcSimulado(tratar, await pc.chave());
  try {
    assert.deepEqual(await pc.executar("abrir_site", "https://www.youtube.com"), { feito: true, mensagem: "feito: abrir_site https://www.youtube.com" });
    assert.deepEqual(await pc.executar("abrir_programa", "calculadora"), { feito: true, mensagem: "feito: abrir_programa calculadora" });
    assert.deepEqual(sim.executados, [["abrir_site", "https://www.youtube.com"], ["abrir_programa", "calculadora"]]);
    await assert.rejects(pc.executar("rodar_comando", "format c:"), /não permitida/);
  } finally {
    await sim.desligar();
  }
});

test("pc: chave errada é recusada; resposta falsa é ignorada; PC desligado ou com erro vira mensagem clara", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const tratar = criarJarvis(armazem, { senha: "segredo", computadorOpcoes: opcoesPcRapido });
  const pc = new Computador(armazem, opcoesPcRapido);
  await pc.instalador("http://x");
  const chave = await pc.chave();
  const ts = Math.floor(Date.now() / 1000);
  assert.equal((await tratar(new Request(`http://x/api/pc/esperar?ts=${ts}&sig=${hmac("outra", `esperar|${ts}`)}`))).status, 401);
  assert.equal((await tratar(new Request(`http://x/api/pc/esperar?ts=${ts - 999}&sig=${hmac(chave, `esperar|${ts - 999}`)}`))).status, 401);
  assert.equal((await tratar(new Request(`http://x/api/pc/esperar?ts=${ts}&sig=${hmac(chave, `esperar|${ts}`)}`))).status, 204);

  await assert.rejects(pc.executar("abrir_programa", "xyz"), /não respondeu/); // PC desligado
  assert.deepEqual(await armazem.listar("pc-fila"), [], "ordem não entregue não fica para depois");

  for (const [opcoes, esperado] of [
    [{ falsificar: true }, /não respondeu/],
    [{ falhar: 'Não achei o programa "xyz" neste computador.' }, /Não achei o programa/],
  ]) {
    const sim = pcSimulado(tratar, chave, opcoes);
    try {
      await assert.rejects(pc.executar("abrir_programa", "xyz"), esperado);
    } finally {
      await sim.desligar();
    }
  }
});

test("pc: ferramenta e rotas do computador", async () => {
  const nomes = criarFerramentas(novoBanco(), null, null, { executar() {} }).definicoes.map((d) => d.name);
  assert.ok(nomes.includes("computador"));
  const tratar = criarJarvis(new ArmazemBlobs(blobsFalso()), { senha: "" });
  const req = (m, c) => tratar(new Request(`http://x${c}`, { method: m }));
  assert.deepEqual(await (await req("GET", "/api/pc/status")).json(), { conectado: false, online: false });
  const baixado = await req("GET", "/api/pc/instalador");
  assert.match(await baixado.clone().text(), /\$Servidor = 'http:\/\/x'/);
  assert.match(baixado.headers.get("content-disposition"), /jarvis-pc\.ps1/);
  assert.deepEqual(await (await req("GET", "/api/pc/status")).json(), { conectado: true, online: false });
  assert.deepEqual(await (await req("POST", "/api/pc/desconectar")).json(), { ok: true });
  assert.deepEqual(await (await req("GET", "/api/pc/status")).json(), { conectado: false, online: false });
});

test("blobs: abre a gaveta de novo a cada uso (o passe de acesso vence entre pedidos)", async () => {
  let aberturas = 0;
  const fabrica = blobsFalso();
  const armazem = new ArmazemBlobs((opcoes) => { aberturas++; return fabrica(opcoes); });
  await armazem.salvar("notas", "a", { id: "a" });
  await armazem.obter("notas", "a");
  await armazem.listar("notas");
  assert.ok(aberturas >= 3, `abriu ${aberturas} vez(es)`);
});

// ---------- Resumo diário no WhatsApp ----------
import { enviarResumoDiario, horaDoResumo, montarResumo } from "../src/resumo.js";

test("resumo diário: sai uma vez na hora marcada, com agenda, lembretes e finanças", async () => {
  process.env.TZ = "America/Sao_Paulo";
  const armazem = new ArmazemBlobs(blobsFalso());
  const banco = new Banco(armazem);
  const cb = callmebotFalso();
  const zap = new WhatsApp({ fetch: cb.f, env: { WHATSAPP_TELEFONE: "+55", WHATSAPP_APIKEY: "1" } });
  const agenda = {
    configurado: true,
    conectado: async () => true,
    listarEventos: async () => [{ titulo: "Dentista", inicio: "2026-11-21T14:30:00-03:00", diaInteiro: false }],
  };
  await banco.adicionarLembrete("pagar a luz", "2026-11-21T18:00:00-03:00");
  await banco.adicionarLembrete("amanhã", "2026-11-22T09:00:00-03:00");
  await banco.adicionarTransacao({ tipo: "entrada", valor: 1000, categoria: "salário", data: "2026-11-05" });
  await banco.adicionarTransacao({ tipo: "saida", valor: 250.5, categoria: "mercado", data: "2026-11-10" });

  const cedo = new Date("2026-11-21T06:59:00-03:00");
  const hora = new Date("2026-11-21T07:00:00-03:00");
  assert.deepEqual(await enviarResumoDiario(banco, armazem, zap, agenda, cedo, 7), { enviado: false });
  assert.deepEqual(await enviarResumoDiario(banco, armazem, zap, agenda, hora, 7), { enviado: true });
  assert.deepEqual(await enviarResumoDiario(banco, armazem, zap, agenda, new Date("2026-11-21T07:01:00-03:00"), 7), { enviado: false });
  assert.equal(cb.enviados.length, 1);
  const texto = cb.enviados[0].texto;
  assert.match(texto, /14:30 – Dentista/);
  assert.match(texto, /18:00 – pagar a luz/);
  assert.doesNotMatch(texto, /amanhã/);
  assert.match(texto, /saldo R\$\s?749,50/);
  assert.match(texto, /mercado R\$\s?250,50/);
  // No dia seguinte manda de novo.
  assert.deepEqual(await enviarResumoDiario(banco, armazem, zap, agenda, new Date("2026-11-22T07:00:00-03:00"), 7), { enviado: true });
});

test("resumo diário: Google desconectado avisa; erro tenta só 3 vezes; hora configurável", async () => {
  process.env.TZ = "America/Sao_Paulo";
  const armazem = new ArmazemBlobs(blobsFalso());
  const banco = new Banco(armazem);
  const texto = await montarResumo(banco, { configurado: true, conectado: async () => false });
  assert.match(texto, /desconectado/);
  assert.doesNotMatch(await montarResumo(banco, { configurado: false }), /Agenda/);

  const ruim = new WhatsApp({ fetch: callmebotFalso("APIKey is invalid").f, env: { WHATSAPP_TELEFONE: "+55", WHATSAPP_APIKEY: "1" } });
  let chamadas = 0;
  const contar = { configurado: true, enviar: async (t) => { chamadas++; return ruim.enviar(t); } };
  for (let m = 0; m < 6; m++) await enviarResumoDiario(banco, armazem, contar, null, new Date(`2026-11-21T07:0${m}:00-03:00`), 7);
  assert.equal(chamadas, 3);

  assert.equal(horaDoResumo({}), 7);
  assert.equal(horaDoResumo({ JARVIS_RESUMO_HORA: "8" }), 8);
  assert.equal(horaDoResumo({ JARVIS_RESUMO_HORA: "desligado" }), null);
});

// ---------- Fuso horário (no Cloudflare o servidor fica em UTC) ----------
import { hojeLocal, horaLocal, inicioDoDia, isoLocal, lerData } from "../src/fuso.js";

test("fuso: datas no horário de Brasília mesmo com o servidor em outro fuso", () => {
  const d = new Date("2026-11-22T01:30:00Z"); // 22:30 do dia 21 em Brasília
  assert.equal(hojeLocal(d), "2026-11-21");
  assert.equal(horaLocal(d), 22);
  assert.equal(inicioDoDia(d).toISOString(), "2026-11-21T03:00:00.000Z");
  assert.equal(inicioDoDia(d, 1).toISOString(), "2026-11-22T03:00:00.000Z");
  assert.equal(isoLocal(d), "2026-11-21T22:30:00-03:00");
  assert.equal(lerData("2026-11-21T17:00").toISOString(), "2026-11-21T20:00:00.000Z");
  assert.equal(lerData("2026-11-21T17:00:00Z").toISOString(), "2026-11-21T17:00:00.000Z");
});

// ---------- Abrir apps e sites no aparelho (botões) ----------
import { montarLink } from "../src/links.js";

test("links: monta endereços seguros para cada app", () => {
  assert.deepEqual(montarLink({ app: "youtube", busca: "receita de bolo" }), { rotulo: 'Ver "receita de bolo" no YouTube', url: "https://www.youtube.com/results?search_query=receita%20de%20bolo" });
  assert.equal(montarLink({ app: "waze", busca: "Farmácia Central, Montes Claros" }).url, "https://waze.com/ul?q=Farm%C3%A1cia%20Central%2C%20Montes%20Claros&navigate=yes");
  assert.equal(montarLink({ app: "whatsapp", numero: "(38) 99900-4949", mensagem: "Chego às 8", nome: "João" }).url, "https://wa.me/5538999004949?text=Chego%20%C3%A0s%208");
  assert.equal(montarLink({ app: "whatsapp", mensagem: "oi" }).url, "https://wa.me/?text=oi");
  assert.equal(montarLink({ app: "ligar", numero: "+55 38 99900-4949", nome: "João" }).url, "tel:+5538999004949");
  assert.throws(() => montarLink({ app: "ligar", numero: "" }), /número/);
  assert.equal(montarLink({ app: "site", busca: "g1.com.br" }).url, "https://g1.com.br");
  assert.equal(montarLink({ app: "site", busca: "javascript:alert(1)" }).url, "https://www.google.com/search?q=javascript%3Aalert(1)");
  assert.equal(montarLink({ app: "instagram", busca: "@jarvis.app" }).url, "https://www.instagram.com/jarvis.app/");
  assert.throws(() => montarLink({ app: "qualquer" }), /não suportado/);
});

test("cérebro: botão de abrir app chega junto com a resposta e o aparelho vai na mensagem", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  cerebro.cliente = clienteFalso([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "abrir_no_aparelho", input: { app: "spotify", busca: "Legião Urbana", numero: "", mensagem: "", nome: "" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "É só tocar no botão." }] },
  ]);
  const r = await cerebro.conversar("c9", "toca Legião Urbana", null, { aparelho: "celular" });
  assert.deepEqual(r.botoes, [{ rotulo: 'Tocar "Legião Urbana" no Spotify', url: "https://open.spotify.com/search/Legi%C3%A3o%20Urbana" }]);
  assert.match(cerebro.cliente.pedidos[0].messages[0].content, /\[Aparelho: celular\]\ntoca Legião Urbana$/);
});

// ---------- Lembretes que se repetem ----------
import { proximaRepeticao } from "../src/fuso.js";

test("repetição: próxima vez no mesmo horário de Brasília", () => {
  const sexta8h = "2026-11-20T11:00:00.000Z"; // sexta, 8h em Brasília
  const agora = new Date("2026-11-20T11:10:00Z");
  assert.equal(proximaRepeticao(sexta8h, "diario", agora).toISOString(), "2026-11-21T11:00:00.000Z");
  assert.equal(proximaRepeticao(sexta8h, "dias_uteis", agora).toISOString(), "2026-11-23T11:00:00.000Z"); // pula o fim de semana
  assert.equal(proximaRepeticao(sexta8h, "semanal", agora).toISOString(), "2026-11-27T11:00:00.000Z");
  assert.equal(proximaRepeticao("2027-01-31T12:00:00.000Z", "mensal", new Date("2027-01-31T13:00:00Z")).toISOString(), "2027-02-28T12:00:00.000Z"); // dia 31 vira 28
  // Servidor parado vários dias: pula direto para a próxima vez no futuro.
  assert.equal(proximaRepeticao(sexta8h, "diario", new Date("2026-11-25T15:00:00Z")).toISOString(), "2026-11-26T11:00:00.000Z");
});

test("repetição: avisa no WhatsApp a cada vez e passa para o próximo dia", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const banco = new Banco(armazem);
  const cb = callmebotFalso();
  const zap = new WhatsApp({ fetch: cb.f, env: { WHATSAPP_TELEFONE: "+55", WHATSAPP_APIKEY: "1" } });
  const l = await banco.adicionarLembrete("tomar o remédio", "2026-11-21T11:00:00Z", "diario");
  assert.equal(l.repetir, "diario");
  assert.equal((await banco.adicionarLembrete("uma vez", "2026-11-21T11:00:00Z", "nao")).repetir, undefined);

  await enviarLembretesVencidos(banco, armazem, zap, new Date("2026-11-21T11:01:00Z"));
  assert.equal(await banco.avancarRepetidos(new Date("2026-11-21T11:02:00Z")), 0, "espera 5 minutos antes de passar para a próxima");
  assert.equal(await banco.avancarRepetidos(new Date("2026-11-21T11:06:00Z")), 1);
  const depois = (await banco.listarLembretes()).find((x) => x.id === l.id);
  assert.equal(depois.quando, "2026-11-22T11:00:00.000Z");
  assert.equal(depois.avisado, false);

  await enviarLembretesVencidos(banco, armazem, zap, new Date("2026-11-22T11:01:00Z"));
  assert.equal(cb.enviados.filter((e) => e.texto.includes("remédio")).length, 2, "um aviso por dia");
  await banco.concluirLembrete(l.id);
  assert.equal(await banco.avancarRepetidos(new Date("2026-11-23T12:00:00Z")), 0, "concluído para de repetir");
});

// ---------- Previsão do tempo e relatório do mês ----------
import { Clima, textoPrevisao } from "../src/clima.js";
import { enviarRelatorioMensal, montarRelatorioMensal } from "../src/resumo.js";

function openMeteoFalso() {
  const urls = [];
  const f = async (url) => {
    urls.push(url);
    if (url.includes("geocoding")) {
      return Response.json({ results: [
        { name: "Montes Claros", admin1: "Goiás", country: "Brasil", latitude: -16.1, longitude: -51.4 },
        { name: "Montes Claros", admin1: "Minas Gerais", country: "Brasil", latitude: -16.73, longitude: -43.86 },
      ] });
    }
    return Response.json({ daily: { time: ["2026-11-22", "2026-11-23"], temperature_2m_max: [31.4, 29], temperature_2m_min: [19.2, 18], precipitation_probability_max: [40, 10], weather_code: [2, 61] } });
  };
  return { f, urls };
}

test("clima: guarda a cidade certa e monta a previsão do resumo", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const om = openMeteoFalso();
  const clima = new Clima(armazem, { fetch: om.f });
  assert.equal(await clima.previsaoDeHoje(), null, "sem cidade, sem previsão");
  const cidade = await clima.definirCidade("Montes Claros, MG");
  assert.equal(cidade.estado, "Minas Gerais");
  const p = await clima.previsaoDeHoje(new Date("2026-11-22T10:00:00Z"));
  assert.equal(textoPrevisao(p), "🌤️ Tempo em Montes Claros: poucas nuvens, máxima de 31° e mínima de 19°, 40% de chance de chuva.");
  assert.match(om.urls.at(-1), /latitude=-16\.73.*timezone=America%2FSao_Paulo/);

  const banco = new Banco(armazem);
  const texto = await montarResumo(banco, null, new Date("2026-11-22T10:00:00Z"), null, clima);
  assert.match(texto, /Tempo em Montes Claros/);
  const semCidade = await montarResumo(banco, null, new Date(), null, new Clima(new ArmazemBlobs(blobsFalso()), { fetch: om.f }));
  assert.match(semCidade, /minha cidade é/);
});

test("relatório mensal: sai no dia 1º com o mês anterior, uma vez só", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const banco = new Banco(armazem);
  const cb = callmebotFalso();
  const zap = new WhatsApp({ fetch: cb.f, env: { WHATSAPP_TELEFONE: "+55", WHATSAPP_APIKEY: "1" } });
  await banco.adicionarTransacao({ tipo: "saida", valor: 100, categoria: "mercado", data: "2026-10-10" });
  await banco.adicionarTransacao({ tipo: "entrada", valor: 3000, categoria: "salário", data: "2026-11-05" });
  await banco.adicionarTransacao({ tipo: "saida", valor: 150, categoria: "mercado", data: "2026-11-10" });
  await banco.adicionarTransacao({ tipo: "saida", valor: 50, categoria: "farmácia", data: "2026-11-12" });

  const texto = await montarRelatorioMensal(banco, "2026-11");
  assert.match(texto, /Relatório de novembro/);
  assert.match(texto, /Saldo: R\$\s?2\.800,00 ✅/);
  assert.match(texto, /• mercado: R\$\s?150,00\n• farmácia/);
  assert.match(texto, /Você gastou 100% a mais que em outubro/);

  assert.deepEqual(await enviarRelatorioMensal(banco, armazem, zap, new Date("2026-11-30T10:00:00Z"), 7), { enviado: false }, "não é dia 1º");
  assert.deepEqual(await enviarRelatorioMensal(banco, armazem, zap, new Date("2026-12-01T10:00:00Z"), 7), { enviado: true });
  assert.deepEqual(await enviarRelatorioMensal(banco, armazem, zap, new Date("2026-12-01T10:30:00Z"), 7), { enviado: false });
  assert.equal(cb.enviados.length, 1);
  assert.match(await montarRelatorioMensal(banco, "2026-09"), /nenhuma entrada ou gasto/);
});

// ---------- Sistema Toledo (somente leitura) ----------
import { Toledo } from "../src/toledo.js";

const carteiraFalsa = {
  hoje: "2026-11-22", mes: "2026-11",
  recebidoNoMes: { total: 12500, alugueis: 2500, vendas: 10000 },
  emAtraso: { quantidade: 1, total: 1050, itens: [{ tipo: "aluguel", nome: "Maria", imovel: "Casa 1", dias: 20, valor: 1000, totalComEncargos: 1050 }] },
  aReceberNoMes: { quantidade: 2, total: 1820, itens: [] },
  vencendoEm7Dias: { quantidade: 0, total: 0, itens: [] },
  vendasDeLotes: [], imoveis: { total: 10, alugados: 5 },
};
const buscaFalsa = (status = 200, corpo = carteiraFalsa) => async (url, opcoes) => {
  buscaFalsa.ultimo = { url, opcoes };
  return { status, ok: status < 400, json: async () => corpo };
};

test("Toledo: sem TOLEDO_URL e TOLEDO_TOKEN a ferramenta não existe", () => {
  const t = new Toledo({});
  assert.equal(t.configurado, false);
  const f = criarFerramentas(novoBanco(), null, null, null, t);
  assert.equal(f.definicoes.some((d) => d.name === "consultar_carteira_toledo"), false);
});

test("Toledo: consulta manda a senha, recorta o assunto e não altera nada", async () => {
  const t = new Toledo({ TOLEDO_URL: "https://x/f", TOLEDO_TOKEN: "segredo" }, buscaFalsa());
  const f = criarFerramentas(novoBanco(), null, null, null, t);
  assert.ok(f.definicoes.some((d) => d.name === "consultar_carteira_toledo"));
  const r = await f.executar("consultar_carteira_toledo", { assunto: "atrasos" });
  assert.equal(buscaFalsa.ultimo.opcoes.headers["x-jarvis-token"], "segredo");
  assert.equal(r.emAtraso.quantidade, 1);
  assert.equal(r.recebidoNoMes, undefined);
});

test("Toledo: senha recusada dá mensagem clara", async () => {
  const t = new Toledo({ TOLEDO_URL: "https://x/f", TOLEDO_TOKEN: "errado" }, buscaFalsa(401, {}));
  await assert.rejects(() => t.consultar("tudo"), /recusou a senha/);
});

test("Toledo: resumo diário inclui a carteira e sobrevive à falha do sistema", async () => {
  const banco = novoBanco();
  const bom = new Toledo({ TOLEDO_URL: "https://x/f", TOLEDO_TOKEN: "s" }, buscaFalsa());
  const texto = await montarResumo(banco, { configurado: false }, new Date("2026-11-22T07:00:00-03:00"), bom);
  assert.match(texto, /Carteira Toledo/);
  assert.match(texto, /Em atraso: 1/);
  const ruim = new Toledo({ TOLEDO_URL: "https://x/f", TOLEDO_TOKEN: "s" }, buscaFalsa(500, {}));
  const texto2 = await montarResumo(banco, { configurado: false }, new Date("2026-11-22T07:00:00-03:00"), ruim);
  assert.match(texto2, /não consegui consultar o sistema/);
  assert.match(texto2, /Finanças do mês/);
});

test("Toledo: usa o fetch padrão sem perder o 'this' (erro Illegal invocation no Cloudflare)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function () {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(new Response(JSON.stringify({ hoje: "2026-11-21", imoveis: { total: 1, alugados: 1 } }), { status: 200 }));
  };
  try {
    const r = await new Toledo({ TOLEDO_URL: "https://x/f", TOLEDO_TOKEN: "s" }).consultar("ocupacao");
    assert.equal(r.imoveis.alugados, 1);
  } finally {
    globalThis.fetch = original;
  }
});

// ---------- Foto de nota fiscal ----------
import { registrarNotaFiscal, validarImagem } from "../src/notaFiscal.js";

function clienteVisao(dados) {
  const pedidos = [];
  return {
    pedidos,
    messages: { async create(p) { pedidos.push(p); return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "n1", name: "dados_da_nota", input: dados }] }; } },
  };
}
const FOTO = { imagem: Buffer.from("foto falsa").toString("base64"), tipo: "image/jpeg" };

test("nota fiscal: lê a foto e registra o gasto com loja, categoria e data", async () => {
  const banco = novoBanco();
  const cliente = clienteVisao({ legivel: true, valor_total: 87.459, estabelecimento: "Drogaria Araujo", categoria: "saúde", data: "2026-11-20", resumo_itens: "remédios e higiene" });
  const r = await registrarNotaFiscal(cliente, banco, FOTO, new Date("2026-11-22T12:00:00Z"));
  assert.match(r.texto, /Anotei o gasto de R\$\s?87,46 em Drogaria Araujo no dia 20\/11, na categoria saúde\./);
  assert.deepEqual(
    { tipo: r.transacao.tipo, valor: r.transacao.valor, categoria: r.transacao.categoria, data: r.transacao.data, descricao: r.transacao.descricao },
    { tipo: "saida", valor: 87.46, categoria: "saúde", data: "2026-11-20", descricao: "Drogaria Araujo - remédios e higiene" },
  );
  const p = cliente.pedidos[0];
  assert.deepEqual(p.tool_choice, { type: "tool", name: "dados_da_nota" });
  assert.equal(p.messages[0].content[0].source.media_type, "image/jpeg");
  assert.equal(p.tools[0].strict, true);
});

test("nota fiscal: foto ilegível não registra; data estranha vira hoje; formato inválido é recusado", async () => {
  const banco = novoBanco();
  const ilegivel = await registrarNotaFiscal(clienteVisao({ legivel: false, valor_total: 0, estabelecimento: "", categoria: "outros", data: "", resumo_itens: "" }), banco, FOTO);
  assert.equal(ilegivel.transacao, null);
  assert.match(ilegivel.texto, /Não consegui ler/);
  assert.equal((await banco.listarTransacoes()).length, 0);

  const futura = await registrarNotaFiscal(clienteVisao({ legivel: true, valor_total: 10, estabelecimento: "", categoria: "inventada", data: "2030-01-01", resumo_itens: "" }), banco, FOTO, new Date("2026-11-22T12:00:00Z"));
  assert.equal(futura.transacao.data, "2026-11-22");
  assert.equal(futura.transacao.categoria, "outros");

  assert.throws(() => validarImagem({ imagem: "abc", tipo: "image/gif" }), /JPG, PNG ou WEBP/);
  assert.throws(() => validarImagem({ imagem: "<script>", tipo: "image/jpeg" }), /defeito/);
});

test("rotas: foto de nota e desfazer o gasto", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const cliente = clienteVisao({ legivel: true, valor_total: 25, estabelecimento: "Padaria", categoria: "alimentação", data: "", resumo_itens: "pão" });
  const tratar = criarJarvis(armazem, { senha: "" });
  // O cliente da IA é o mesmo do cérebro; nos testes, troca pelo simulado.
  const tratarComCliente = criarJarvis(armazem, { senha: "", cliente });
  const post = (t, c, corpo) => t(new Request(`http://x${c}`, { method: "POST", body: JSON.stringify(corpo) }));
  assert.equal((await post(tratar, "/api/nota-fiscal", { imagem: "x", tipo: "image/gif" })).status, 400);
  const r = await (await post(tratarComCliente, "/api/nota-fiscal", FOTO)).json();
  assert.equal(r.transacao.valor, 25);
  assert.deepEqual(await (await post(tratar, "/api/transacoes/apagar", { id: r.transacao.id })).json(), { apagada: true });
  assert.equal((await new Banco(armazem).listarTransacoes()).length, 0);
});

// ---------- Telegram (simulado) ----------
import { Telegram } from "../src/telegram.js";

function telegramFalso() {
  const chamadas = [];
  const f = async (url, opcoes = {}) => {
    const metodo = url.split("/").pop();
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;
    chamadas.push({ metodo, corpo, url });
    if (url.includes("/file/bot")) return new Response(Buffer.from("jpeg falso"));
    const resultados = { getMe: { username: "MeuJarvisBot" }, getFile: { file_path: "photos/f1.jpg" } };
    return Response.json({ ok: true, result: resultados[metodo] ?? true });
  };
  const enviadas = () => chamadas.filter((c) => c.metodo === "sendMessage").map((c) => c.corpo);
  return { f, chamadas, enviadas };
}

test("telegram: liga com código de uso único, conversa só com o dono e ignora estranhos", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const tg = telegramFalso();
  const env = { TELEGRAM_BOT_TOKEN: "123:ABC" };
  const banco = new Banco(armazem);
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  cerebro.cliente = clienteFalso([{ stop_reason: "end_turn", content: [{ type: "text", text: "Você gastou R$ 30,00 este mês." }] }]);
  const tratar = criarJarvis(armazem, { senha: "s", cliente: cerebro.cliente, telegramOpcoes: { fetch: tg.f, env } });
  const telegram = new Telegram(armazem, { fetch: tg.f, env });
  const pedir = (m, c, corpo) => tratar(new Request(`https://jarvis.exemplo${c}`, { method: m, headers: { "x-jarvis-senha": "s" }, body: corpo && JSON.stringify(corpo) }));
  const webhook = (update, segredo = telegram.segredoWebhook) =>
    tratar(new Request("https://jarvis.exemplo/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": segredo }, body: JSON.stringify(update) }));
  const msg = (id, chat, text) => ({ update_id: id, message: { chat: { id: chat }, from: { first_name: "W" }, text } });

  assert.deepEqual(await (await pedir("GET", "/api/telegram/status")).json(), { configurado: true, conectado: false, bot: null });
  const { link, bot } = await (await pedir("POST", "/api/telegram/conectar", {})).json();
  assert.equal(bot, "MeuJarvisBot");
  const webhookConf = tg.chamadas.find((c) => c.metodo === "setWebhook").corpo;
  assert.equal(webhookConf.url, "https://jarvis.exemplo/api/telegram/webhook");
  assert.equal(webhookConf.secret_token, telegram.segredoWebhook);
  const codigo = link.split("start=")[1];

  assert.equal((await webhook(msg(1, 555, "/start " + codigo), "segredo-errado")).status, 401);
  await webhook(msg(2, 999, "/start errado")); // estranho
  assert.match(tg.enviadas().at(-1).text, /particular/);
  await webhook(msg(3, 555, "/start " + codigo)); // o dono, pelo link
  assert.match(tg.enviadas().at(-1).text, /Telegram conectado/);
  assert.deepEqual(await (await pedir("GET", "/api/telegram/status")).json(), { configurado: true, conectado: true, bot: "MeuJarvisBot" });
  await webhook(msg(4, 999, "quanto gastei?")); // estranho de novo: nada
  const antes = tg.enviadas().length;
  await webhook(msg(5, 555, "quanto gastei?"));
  await webhook(msg(5, 555, "quanto gastei?")); // o Telegram reenviou: responde uma vez só
  assert.equal(tg.enviadas().length, antes + 1);
  assert.equal(tg.enviadas().at(-1).text, "Você gastou R$ 30,00 este mês.");
  assert.equal(tg.enviadas().at(-1).chat_id, 555);
  assert.match(cerebro.cliente.pedidos[0].messages[0].content, /\[Aparelho: celular\]/);
  await webhook(msg(6, 555, "/start " + codigo)); // código já usado não religa nada
});

test("telegram: foto vira gasto e botões viram links", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const tg = telegramFalso();
  const telegram = new Telegram(armazem, { fetch: tg.f, env: { TELEGRAM_BOT_TOKEN: "1:X" } });
  await armazem.salvar("config", "telegram", { chatId: 7 });
  let fotoRecebida;
  await telegram.processar({ update_id: 1, message: { chat: { id: 7 }, photo: [{ file_id: "p" }, { file_id: "g" }] } }, {
    notaFiscal: async (foto) => { fotoRecebida = foto; return { texto: "Anotei o gasto de R$ 10,00.", transacao: { id: "t1" } }; },
  });
  assert.equal(tg.chamadas.find((c) => c.metodo === "getFile").corpo.file_id, "g", "usa a foto maior");
  assert.equal(fotoRecebida.imagem, Buffer.from("jpeg falso").toString("base64"));
  assert.equal(tg.enviadas().at(-1).text, "Anotei o gasto de R$ 10,00.");

  await telegram.processar({ update_id: 2, message: { chat: { id: 7 }, text: "toca Legião" } }, {
    conversar: async () => ({ texto: "Toque no botão.", botoes: [{ rotulo: "Spotify", url: "https://open.spotify.com/search/x" }, { rotulo: "Ligar para João", url: "tel:3899" }] }),
  });
  const ultima = tg.enviadas().at(-1);
  assert.deepEqual(ultima.reply_markup, { inline_keyboard: [[{ text: "Spotify", url: "https://open.spotify.com/search/x" }]] });
  assert.match(ultima.text, /Ligar para João: 3899/);

  await telegram.processar({ update_id: 3, message: { chat: { id: 7 }, text: "oi" } }, {
    conversar: async () => { const e = new Error("x"); e.mensagemParaUsuario = "Seus créditos acabaram."; throw e; },
  });
  assert.equal(tg.enviadas().at(-1).text, "Seus créditos acabaram.");
});

test("telegram: lembretes e resumo também chegam no Telegram (para responder no carro)", async () => {
  process.env.TZ = "America/Sao_Paulo";
  const armazem = new ArmazemBlobs(blobsFalso());
  const banco = new Banco(armazem);
  const tg = telegramFalso();
  const telegram = new Telegram(armazem, { fetch: tg.f, env: { TELEGRAM_BOT_TOKEN: "1:X" } });
  assert.equal((await telegram.canal()).configurado, false, "sem chat ligado, nada vai para o Telegram");
  await armazem.salvar("config", "telegram", { chatId: 42 });
  const canal = await telegram.canal();
  await banco.adicionarLembrete("tomar o remédio", "2026-11-21T11:00:00Z");
  assert.deepEqual(await enviarLembretesVencidos(banco, armazem, canal, new Date("2026-11-21T11:01:00Z")), { enviados: 1 });
  assert.deepEqual(await enviarLembretesVencidos(banco, armazem, canal, new Date("2026-11-21T11:02:00Z")), { enviados: 0 });
  assert.equal(tg.enviadas().at(-1).text, "⏰ Lembrete do Jarvis: tomar o remédio");
  assert.equal(tg.enviadas().at(-1).chat_id, 42);
  // O registro do Telegram é separado do WhatsApp: um não impede o outro.
  const cb = callmebotFalso();
  const zap = new WhatsApp({ fetch: cb.f, env: { WHATSAPP_TELEFONE: "+55", WHATSAPP_APIKEY: "1" } });
  assert.deepEqual(await enviarLembretesVencidos(banco, armazem, zap, new Date("2026-11-21T11:02:00Z")), { enviados: 1 });

  assert.deepEqual(await enviarResumoDiario(banco, armazem, canal, null, new Date("2026-11-22T10:00:00Z"), 7), { enviado: true });
  assert.deepEqual(await enviarResumoDiario(banco, armazem, zap, null, new Date("2026-11-22T10:00:00Z"), 7), { enviado: true });
  assert.match(tg.enviadas().at(-1).text, /Bom dia/);
});

// ---------- Instagram: post pronto e avisos de comentários/mensagens ----------
import { Instagram } from "../src/instagram.js";

test("instagram: post pronto chega junto com a resposta (tela e Telegram)", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  cerebro.cliente = clienteFalso([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "p1", name: "post_instagram", input: { legenda: "🏡 Lote 09, Quadra 10!\nChame no direct.", hashtags: "#lotes #montesclaros", melhor_horario: "terça às 19h" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Pronto, o post está na tela. Poste na terça às 19h." }] },
  ]);
  const r = await cerebro.conversar("ig1", "faz um post do lote 09");
  assert.deepEqual(r.posts, [{ texto: "🏡 Lote 09, Quadra 10!\nChame no direct.\n\n#lotes #montesclaros", melhor_horario: "terça às 19h" }]);
  await assert.rejects(criarFerramentas(banco).executar("post_instagram", { legenda: " ", hashtags: "", melhor_horario: "" }), /vazio/);
});

function graphFalso() {
  const estado = { comentarios: [{ id: "c1", text: "quanto custa o lote?", username: "maria", timestamp: "2026-11-22T10:00:00+0000" }], mensagens: [], renovados: 0 };
  const urls = [];
  const f = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const p = u.pathname;
    if (p.endsWith("/refresh_access_token")) { estado.renovados++; return Response.json({ access_token: "token-novo", expires_in: 5184000 }); }
    if (p.endsWith("/me")) return Response.json({ user_id: "999", username: "portoetoledo" });
    if (p.endsWith("/me/media")) return Response.json({ data: [{ id: "p1", caption: "Lote 09 da Quadra 10 à venda", comments_count: estado.comentarios.length }] });
    if (p.endsWith("/p1/comments")) return Response.json({ data: estado.comentarios });
    if (p.endsWith("/me/conversations")) return Response.json({ data: [{ messages: { data: estado.mensagens } }] });
    return Response.json({ error: { message: "rota desconhecida", code: 100 } }, { status: 400 });
  };
  return { f, estado, urls };
}

test("instagram: primeira vez só marca o que já existe; depois avisa cada novidade uma vez", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const g = graphFalso();
  const ig = new Instagram(armazem, { fetch: g.f, env: { INSTAGRAM_TOKEN: "tok" } });
  const avisos = [];
  const canal = { configurado: true, enviar: async (t) => avisos.push(t) };
  const desligado = { configurado: false, enviar: async () => assert.fail("não deveria enviar") };
  let t = Date.parse("2026-11-22T12:00:00Z");

  assert.deepEqual(await ig.verificar([canal, desligado], t), { avisos: 0 }, "primeira vez não avisa o antigo");
  g.estado.comentarios.push({ id: "c2", text: "tem financiamento?", username: "joao", timestamp: "x" }, { id: "c3", text: "obrigado!", username: "portoetoledo", timestamp: "x" });
  g.estado.mensagens.push({ id: "m1", message: "Oi, quero visitar o lote", from: { username: "ana", id: "1" }, created_time: "x" }, { id: "m2", message: "Claro!", from: { username: "portoetoledo", id: "999" }, created_time: "x" });

  assert.deepEqual(await ig.verificar([canal], t + 60_000), { avisos: 0 }, "espera 5 minutos entre conferências");
  assert.deepEqual(await ig.verificar([canal, desligado], t += 5 * 60_000), { avisos: 2 });
  assert.deepEqual(avisos, ['📸 Instagram: @joao comentou em "Lote 09 da Quadra 10 à venda": "tem financiamento?"', '💬 Instagram: mensagem de @ana: "Oi, quero visitar o lote"']);
  assert.deepEqual(await ig.verificar([canal], t += 5 * 60_000), { avisos: 0 }, "não repete");

  const resumo = await ig.textoResumo(t);
  assert.match(resumo, /1 comentário e 1 mensagem/);
  assert.match(resumo, /@ana: "Oi, quero visitar o lote"/);
  assert.equal((await ig.recentes(24, t)).length, 2);

  // Depois de 7 dias, renova o token sozinho e passa a usar o novo.
  await ig.verificar([canal], t += 8 * 24 * 3600_000);
  assert.equal(g.estado.renovados, 1);
  await ig.verificar([canal], t += 5 * 60_000);
  assert.match(g.urls.at(-1), /access_token=token-novo/);
});

test("instagram: token inválido vira mensagem clara; sem token não faz nada", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const ruim = async () => Response.json({ error: { message: "Error validating access token", code: 190 } }, { status: 400 });
  const ig = new Instagram(armazem, { fetch: ruim, env: { INSTAGRAM_TOKEN: "velho" } });
  await assert.rejects(ig.verificar([], Date.now()), /token do Instagram venceu/);
  assert.deepEqual(await new Instagram(armazem, { env: {} }).verificar([]), { avisos: 0 });
});

// ---------- Marcador técnico vazado ("antml:final_response:") ----------
import { filtroDeMarcador } from "../src/cerebro.js";

test("cérebro: marcador técnico some da fala, da resposta e do histórico", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  cerebro.cliente = clienteFalso([
    { stop_reason: "end_turn", content: [{ type: "text", text: "antml:final_response:Boa noite! Tudo certo." }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Pronto." }] },
  ]);
  let falado = "";
  const r = await cerebro.conversar("mk1", "oi", (d) => (falado += d));
  assert.equal(r.texto, "Boa noite! Tudo certo.");
  assert.equal(falado, "Boa noite! Tudo certo.");
  await cerebro.conversar("mk1", "e agora?");
  assert.equal(cerebro.cliente.pedidos[1].messages[1].content[0].text, "Boa noite! Tudo certo.", "o histórico não leva o marcador");

  // Conversa antiga já gravada com o marcador: é limpa antes de ir de novo para a IA.
  await banco.salvarConversa("mk2", [{ role: "user", content: "oi" }, { role: "assistant", content: [{ type: "text", text: "antml:final_response:Olá" }] }]);
  cerebro.cliente = clienteFalso([{ stop_reason: "end_turn", content: [{ type: "text", text: "Certo." }] }]);
  await cerebro.conversar("mk2", "tudo bem?");
  assert.equal(cerebro.cliente.pedidos[0].messages[1].content[0].text, "Olá");
});

test("filtro: segura o começo só enquanto pode ser o marcador", () => {
  const rodar = (pedacos) => { const f = filtroDeMarcador(); return pedacos.map((p) => f.passar(p)).join("") + f.terminar(); };
  assert.equal(rodar(["antml:final_", "response: Oi", " tudo bem"]), "Oi tudo bem");
  assert.equal(rodar(["antes de ", "tudo"]), "antes de tudo");
  assert.equal(rodar(["Boa noite"]), "Boa noite");
  const f = filtroDeMarcador();
  assert.equal(f.passar("Olá"), "Olá", "texto normal passa na hora, sem atraso");
});

// ---------- Orientação jurídica e documentos prontos ----------
import { partes } from "../src/telegram.js";

test("jurídico: instruções de advogado no sistema e documento pronto com botão de copiar", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  assert.match(cerebro.sistema, /advogado brasileiro experiente/);
  assert.match(cerebro.sistema, /Lei 8\.245\/91/);
  assert.match(cerebro.sistema, /OAB/);
  cerebro.cliente = clienteFalso([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "d1", name: "documento_pronto", input: { titulo: "Notificação extrajudicial", texto: "NOTIFICAÇÃO\n\nPrezado [nome do inquilino]..." } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "A notificação está na tela. Complete o nome do inquilino." }] },
  ]);
  const r = await cerebro.conversar("adv1", "faz uma notificação de atraso");
  assert.deepEqual(r.posts, [{ titulo: "Notificação extrajudicial", texto: "NOTIFICAÇÃO\n\nPrezado [nome do inquilino]..." }]);
  await assert.rejects(criarFerramentas(banco).executar("documento_pronto", { titulo: "x", texto: " " }), /vazio/);
});

test("telegram: documento longo vai em partes, cortando em quebra de linha", async () => {
  const texto = Array.from({ length: 300 }, (_, i) => `Cláusula ${i + 1}: texto da cláusula com algumas palavras.`).join("\n");
  const pedacos = partes(texto, 3800);
  assert.ok(pedacos.length > 1);
  assert.ok(pedacos.every((p) => p.length <= 3800));
  assert.equal(pedacos.join("\n"), texto);

  const armazem = new ArmazemBlobs(blobsFalso());
  const tg = telegramFalso();
  const telegram = new Telegram(armazem, { fetch: tg.f, env: { TELEGRAM_BOT_TOKEN: "1:X" } });
  await armazem.salvar("config", "telegram", { chatId: 9 });
  await telegram.processar({ update_id: 1, message: { chat: { id: 9 }, text: "faz um contrato" } }, {
    conversar: async () => ({ texto: "O contrato está pronto.", posts: [{ titulo: "Contrato de locação", texto }] }),
  });
  const enviadas = tg.enviadas();
  assert.equal(enviadas[0].text, "O contrato está pronto.");
  assert.match(enviadas[1].text, /^Contrato de locação\n\nCláusula 1:/);
  assert.ok(enviadas.length >= 3, "o documento foi dividido");
});

test("especialistas: farmacêutico, contador e corretor estão nas instruções", () => {
  const banco = novoBanco();
  const { sistema } = new Cerebro(criarFerramentas(banco), banco);
  assert.match(sistema, /usuário é farmacêutico/);
  assert.match(sistema, /Portaria 344\/98/);
  assert.match(sistema, /carnê-leão/);
  assert.match(sistema, /ganho de capital/);
  assert.match(sistema, /CRC/);
  assert.match(sistema, /IGP-M ou IPCA/);
  assert.match(sistema, /CRECI/);
});

// ---------- Foto ou PDF de documento para análise ----------
test("documento: a foto vai para a IA junto com a pergunta, mas não fica guardada no histórico", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco), banco);
  cerebro.cliente = clienteFalso([
    { stop_reason: "end_turn", content: [{ type: "text", text: "É um contrato de locação de 30 meses. A multa da cláusula 8 está alta." }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Pode negociar para 3 aluguéis." }] },
  ]);
  const foto = { imagem: Buffer.from("foto").toString("base64"), tipo: "image/jpeg" };
  const r = await cerebro.conversar("doc1", "esse contrato está bom?", null, { anexo: foto });
  assert.match(r.texto, /contrato de locação/);
  const enviado = cerebro.cliente.pedidos[0].messages[0].content;
  assert.deepEqual(enviado[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: foto.imagem } });
  assert.match(enviado[1].text, /esse contrato está bom\?\n\[Documento anexado\]$/);

  await cerebro.conversar("doc1", "e a multa?");
  const historico = cerebro.cliente.pedidos[1].messages[0].content;
  assert.equal(historico[0].type, "text", "a foto virou um aviso no histórico");
  assert.match(historico[0].text, /enviou um documento/);

  const pdf = { imagem: Buffer.from("%PDF").toString("base64"), tipo: "application/pdf" };
  cerebro.cliente = clienteFalso([{ stop_reason: "end_turn", content: [{ type: "text", text: "Ok." }] }]);
  await cerebro.conversar("doc2", "analisa", null, { anexo: pdf });
  assert.equal(cerebro.cliente.pedidos[0].messages[0].content[0].type, "document");
  await assert.rejects(cerebro.conversar("doc3", "x", null, { anexo: { imagem: "abc", tipo: "image/gif" } }), /foto \(JPG, PNG ou WEBP\) ou um PDF/);
});

test("telegram: foto com legenda e PDF são analisados; foto sem legenda que não é nota também", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const tg = telegramFalso();
  const telegram = new Telegram(armazem, { fetch: tg.f, env: { TELEGRAM_BOT_TOKEN: "1:X" } });
  await armazem.salvar("config", "telegram", { chatId: 5 });
  const pedidos = [];
  const jarvis = {
    conversar: async (conversa, texto, anexo) => { pedidos.push({ texto, tipo: anexo?.tipo }); return { texto: "Análise pronta." }; },
    notaFiscal: async () => ({ texto: "Não consegui ler o valor.", transacao: null }),
  };
  await telegram.processar({ update_id: 1, message: { chat: { id: 5 }, caption: "essa receita está certa?", photo: [{ file_id: "f" }] } }, jarvis);
  await telegram.processar({ update_id: 2, message: { chat: { id: 5 }, document: { file_id: "d", mime_type: "application/pdf" } } }, jarvis);
  await telegram.processar({ update_id: 3, message: { chat: { id: 5 }, photo: [{ file_id: "g" }] } }, jarvis);
  assert.deepEqual(pedidos, [
    { texto: "essa receita está certa?", tipo: "image/jpeg" },
    { texto: "Analise este documento e me oriente.", tipo: "application/pdf" },
    { texto: "Analise este documento e me oriente.", tipo: "image/jpeg" },
  ]);
  assert.equal(tg.enviadas().at(-1).text, "Análise pronta.");
});

test("rotas: conversa ao vivo aceita documento e recusa formato inválido", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const cliente = clienteFalso([{ stop_reason: "end_turn", content: [{ type: "text", text: "É uma notificação." }] }]);
  const tratar = criarJarvis(armazem, { senha: "", cliente });
  const post = (corpo) => tratar(new Request("http://x/api/conversar/ao-vivo", { method: "POST", body: JSON.stringify(corpo) }));
  assert.equal((await post({ conversa: "c1", imagem: "abc", tipo: "image/gif" })).status, 400);
  const texto = await (await post({ conversa: "c1", imagem: Buffer.from("x").toString("base64"), tipo: "image/png" })).text();
  assert.match(texto, /É uma notificação/);
  assert.match(cliente.pedidos[0].messages[0].content[1].text, /Analise este documento e me oriente\./);
});

// ---------- Tela nova: resumo de hoje e painel da Toledo ----------
test("rotas: resumo de hoje e painel da Porto e Toledo", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const original = globalThis.fetch;
  const tratar = criarJarvis(armazem, { senha: "" });
  const get = async (c) => (await tratar(new Request(`http://x${c}`))).json();
  await new Banco(armazem).adicionarLembrete("Pagar a luz", new Date(Date.now() + 3600e3).toISOString());
  const h = await get("/api/hoje");
  assert.equal(h.proximoLembrete.texto, "Pagar a luz");
  assert.equal(h.previsao, null);
  assert.equal(h.toledo, null);
  assert.deepEqual(await get("/api/toledo/painel"), { configurado: false });

  // Com o sistema Toledo ligado
  process.env.TOLEDO_URL = "https://toledo.exemplo/jarvis-leitura";
  process.env.TOLEDO_TOKEN = "t";
  globalThis.fetch = async () => Response.json(carteiraFalsa);
  try {
    const comToledo = criarJarvis(armazem, { senha: "" });
    const painel = await (await comToledo(new Request("http://x/api/toledo/painel"))).json();
    assert.equal(painel.configurado, true);
    assert.equal(painel.recebidoNoMes.total, 12500);
    const hoje = await (await comToledo(new Request("http://x/api/hoje"))).json();
    assert.deepEqual(hoje.toledo, { atrasos: 1, totalAtraso: 1050, vencendo: 0 });
  } finally {
    globalThis.fetch = original;
    delete process.env.TOLEDO_URL; delete process.env.TOLEDO_TOKEN;
  }
});

// ---------- Modo Escola (senha da estudante) ----------
test("modo escola: senha da estudante só conversa com o professor; o resto é bloqueado", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const cliente = clienteFalso([
    { stop_reason: "end_turn", content: [{ type: "text", text: "Vamos lá! Gato em inglês é [en]cat[/en]." }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Oi, adulto." }] },
  ]);
  const tratar = criarJarvis(armazem, { senha: "pai123", senhaEstudante: "filha10", cliente });
  const pedir = (m, c, s, corpo) => tratar(new Request(`http://x${c}`, { method: m, headers: { "x-jarvis-senha": s }, body: m === "GET" ? undefined : corpo && JSON.stringify(corpo) }));

  assert.deepEqual(await (await pedir("GET", "/api/perfil", "filha10")).json(), { perfil: "estudante" });
  assert.deepEqual(await (await pedir("GET", "/api/perfil", "pai123")).json(), { perfil: "adulto" });
  assert.equal((await pedir("GET", "/api/perfil", "errada")).status, 401);

  // Tudo o que é do adulto fica bloqueado para a estudante.
  for (const [m, c] of [["GET", "/api/painel"], ["GET", "/api/toledo/painel"], ["GET", "/api/hoje"], ["POST", "/api/transacoes"], ["POST", "/api/nota-fiscal"],
    ["POST", "/api/conversar"], ["GET", "/api/pc/instalador"], ["POST", "/api/whatsapp/teste"], ["POST", "/api/telegram/conectar"], ["GET", "/api/lembretes/vencidos"]]) {
    assert.equal((await pedir(m, c, "filha10", {})).status, 403, `${m} ${c} deveria estar bloqueado`);
  }

  // A conversa da estudante usa o professor, sem ferramentas do adulto.
  const texto = await (await pedir("POST", "/api/conversar/ao-vivo", "filha10", { conversa: "c1", texto: "como fala gato em inglês?" })).text();
  assert.match(texto, /\[en\]cat\[\/en\]/);
  const p = cliente.pedidos[0];
  assert.match(p.system, /Modo Escola/);
  assert.match(p.system, /Não entregue a resposta pronta/);
  assert.deepEqual(p.tools.map((t) => t.name), ["web_search", "documento_pronto"]);
  assert.ok(await armazem.obter("conversas", "escola-c1"), "conversa da escola fica separada");

  // O adulto continua com tudo.
  await (await pedir("POST", "/api/conversar/ao-vivo", "pai123", { conversa: "c1", texto: "oi" })).text();
  assert.match(cliente.pedidos[1].system, /assistente pessoal/);
  assert.ok(cliente.pedidos[1].tools.some((t) => t.name === "registrar_transacao"));
  assert.equal((await pedir("GET", "/api/painel", "pai123")).status, 200);
});

test("modo escola: sem senha da estudante configurada, só a senha do adulto entra", async () => {
  const tratar = criarJarvis(new ArmazemBlobs(blobsFalso()), { senha: "pai123", senhaEstudante: "" });
  const r = await tratar(new Request("http://x/api/perfil", { headers: { "x-jarvis-senha": "" } }));
  assert.equal(r.status, 401);
});

test("telegram: marcas de voz em inglês não aparecem na mensagem", async () => {
  const tg = telegramFalso();
  const telegram = new Telegram(new ArmazemBlobs(blobsFalso()), { fetch: tg.f, env: { TELEGRAM_BOT_TOKEN: "1:X" } });
  await telegram.enviar(1, "Gato em inglês é [en]cat[/en].");
  assert.equal(tg.enviadas().at(-1).text, "Gato em inglês é cat.");
});
