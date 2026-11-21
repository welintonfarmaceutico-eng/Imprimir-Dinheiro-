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
