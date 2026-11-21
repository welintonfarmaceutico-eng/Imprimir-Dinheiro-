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

// ---------- Computador (Jarvis PC), com ntfy e PC simulados ----------
import { Computador } from "../src/computador.js";
import cryptoNode from "node:crypto";

// ntfy em memória + um "PC" que segue as mesmas regras do script do Windows.
function ntfyComPc({ pcLigado = true, falsificar = false, falhar = null } = {}) {
  const topicos = new Map();
  let chavePc = null;
  const hmac = (k, t) => cryptoNode.createHmac("sha256", k).update(t, "utf8").digest("hex");
  const publicar = (topico, mensagem) => {
    if (!topicos.has(topico)) topicos.set(topico, []);
    topicos.get(topico).push({ id: String(Math.random()), time: Math.floor(Date.now() / 1000), event: "message", topic: topico, message: mensagem });
  };
  const executados = [];
  const f = async (url, opcoes = {}) => {
    const u = new URL(url);
    const topico = u.pathname.split("/")[1];
    if (opcoes.method === "POST") {
      publicar(topico, opcoes.body);
      // O "PC" recebe a ordem, confere a assinatura e responde assinado.
      const c = JSON.parse(opcoes.body);
      if (pcLigado && chavePc && hmac(chavePc, `${c.id}|${c.acao}|${c.alvo}|${c.ts}`) === c.sig) {
        executados.push([c.acao, c.alvo]);
        const ok = !falhar;
        const mensagem = falhar || `feito: ${c.acao} ${c.alvo}`;
        const { respostas } = Computador.topicos(chavePc);
        const sig = falsificar ? "0".repeat(64) : hmac(chavePc, `${c.id}|${ok}|${mensagem}`);
        setTimeout(() => publicar(respostas, JSON.stringify({ id: c.id, ok, mensagem, sig })), 50);
      }
      return new Response("{}", { status: 200 });
    }
    const since = Number(u.searchParams.get("since") || 0);
    const linhas = (topicos.get(topico) || []).filter((m) => m.time >= since).map((m) => JSON.stringify(m)).join("\n");
    return new Response(linhas, { status: 200 });
  };
  return { f, executados, instalarChave: (k) => (chavePc = k) };
}

test("pc: instalador cria a chave e preenche o script do Windows", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const pc = new Computador(armazem, { fetch: async () => new Response(""), servidor: "https://ntfy.sh" });
  assert.equal(await pc.configurado(), false);
  await assert.rejects(pc.executar("volume", "subir"), /ainda não foi conectado/);
  const script = await pc.instalador();
  const chave = await pc.chave();
  const { comandos, respostas } = Computador.topicos(chave);
  assert.ok(script.startsWith("﻿"), "precisa do BOM para o PowerShell 5 ler acentos");
  assert.ok(script.includes(`$Chave = '${chave}'`));
  assert.ok(script.includes(comandos) && script.includes(respostas));
  assert.ok(!/__[A-Z_]+__/.test(script), "não pode sobrar marcador");
  assert.ok(script.includes("\r\n"));
  assert.match(comandos, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(await pc.chave(), chave, "baixar de novo mantém a mesma chave");
  await pc.instalador();
  assert.equal(await pc.chave(), chave);
});

test("pc: ordem assinada chega ao PC e a resposta assinada volta", async () => {
  const armazem = new ArmazemBlobs(blobsFalso());
  const sim = ntfyComPc();
  const pc = new Computador(armazem, { fetch: sim.f, servidor: "https://ntfy.teste", esperaMs: 3000 });
  await pc.instalador();
  sim.instalarChave(await pc.chave());
  assert.deepEqual(await pc.executar("abrir_site", "https://www.youtube.com"), { feito: true, mensagem: "feito: abrir_site https://www.youtube.com" });
  assert.deepEqual(sim.executados, [["abrir_site", "https://www.youtube.com"]]);
  await assert.rejects(pc.executar("rodar_comando", "format c:"), /não permitida/);
});

test("pc: resposta falsa é ignorada; PC desligado ou com erro vira mensagem clara", async () => {
  for (const [opcoes, esperado] of [
    [{ falsificar: true }, /não respondeu/],
    [{ pcLigado: false }, /não respondeu/],
    [{ falhar: 'Não achei o programa "xyz" neste computador.' }, /Não achei o programa/],
  ]) {
    const armazem = new ArmazemBlobs(blobsFalso());
    const sim = ntfyComPc(opcoes);
    const pc = new Computador(armazem, { fetch: sim.f, servidor: "https://ntfy.teste", esperaMs: 1500 });
    await pc.instalador();
    sim.instalarChave(await pc.chave());
    await assert.rejects(pc.executar("abrir_programa", "xyz"), esperado);
  }
});

test("pc: ferramenta e rotas do computador", async () => {
  const nomes = criarFerramentas(novoBanco(), null, null, { executar() {} }).definicoes.map((d) => d.name);
  assert.ok(nomes.includes("computador"));
  const tratar = criarJarvis(new ArmazemBlobs(blobsFalso()), { senha: "" });
  const req = (m, c) => tratar(new Request(`http://x${c}`, { method: m }));
  assert.deepEqual(await (await req("GET", "/api/pc/status")).json(), { conectado: false });
  const baixado = await req("GET", "/api/pc/instalador");
  assert.match(baixado.headers.get("content-disposition"), /jarvis-pc\.ps1/);
  assert.deepEqual(await (await req("GET", "/api/pc/status")).json(), { conectado: true });
  assert.deepEqual(await (await req("POST", "/api/pc/desconectar")).json(), { ok: true });
  assert.deepEqual(await (await req("GET", "/api/pc/status")).json(), { conectado: false });
});
