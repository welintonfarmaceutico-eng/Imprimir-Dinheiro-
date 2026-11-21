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
  return { pedidos, beta: { messages: { create: async (p) => { pedidos.push(structuredClone(p)); return respostas.shift(); } } } };
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

  cerebro.cliente = { beta: { messages: { create: async () => { throw new Error("rede"); } } } };
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
