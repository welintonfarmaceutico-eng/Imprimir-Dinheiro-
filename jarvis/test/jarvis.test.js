import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Banco } from "../src/db.js";
import { criarFerramentas } from "../src/ferramentas.js";
import { Cerebro } from "../src/cerebro.js";

process.env.ANTHROPIC_API_KEY ||= "teste";
const novoBanco = () => new Banco(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-")), "db.json"));

test("finanças: registra e resume o mês", () => {
  const b = novoBanco();
  b.adicionarTransacao({ tipo: "entrada", valor: 2000, categoria: "Salário", data: "2026-11-05" });
  b.adicionarTransacao({ tipo: "saida", valor: 35.5, categoria: "alimentação", data: "2026-11-10" });
  b.adicionarTransacao({ tipo: "saida", valor: 14.5, categoria: "alimentação", data: "2026-11-11" });
  b.adicionarTransacao({ tipo: "saida", valor: 99, categoria: "lazer", data: "2026-10-30" });
  const r = b.resumoFinanceiro("2026-11");
  assert.equal(r.entradas, 2000);
  assert.equal(r.saidas, 50);
  assert.equal(r.saldo, 1950);
  assert.deepEqual(r.gastosPorCategoria, { "alimentação": 50 });
  assert.throws(() => b.adicionarTransacao({ tipo: "saida", valor: -1 }));
});

test("lembretes: avisa só uma vez quando vence", () => {
  const b = novoBanco();
  b.adicionarLembrete("passado", "2020-01-01T10:00:00-03:00");
  b.adicionarLembrete("futuro", "2099-01-01T10:00:00-03:00");
  assert.deepEqual(b.lembretesVencidos().map((l) => l.texto), ["passado"]);
  assert.equal(b.lembretesVencidos().length, 0);
  assert.throws(() => b.adicionarLembrete("x", "amanhã"));
});

test("dados persistem no arquivo", () => {
  const b = novoBanco();
  b.adicionarNota("comprar pão");
  const b2 = new Banco(b.arquivo);
  assert.equal(b2.listarNotas()[0].texto, "comprar pão");
});

test("ferramentas têm esquema estrito válido", () => {
  const { definicoes } = criarFerramentas(novoBanco());
  for (const d of definicoes) {
    assert.equal(d.strict, true);
    assert.equal(d.input_schema.additionalProperties, false);
    assert.deepEqual(d.input_schema.required, Object.keys(d.input_schema.properties));
  }
});

test("cérebro: executa ferramenta e mantém histórico intacto", async () => {
  const banco = novoBanco();
  const cerebro = new Cerebro(criarFerramentas(banco));
  const pedidos = [];
  const respostas = [
    {
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "abc" },
        { type: "tool_use", id: "t1", name: "registrar_transacao", input: { tipo: "saida", valor: 30, categoria: "alimentação", descricao: "almoço", data: "" } },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Anotado: R$ 30,00 no almoço." }] },
  ];
  cerebro.cliente = { beta: { messages: { create: async (p) => { pedidos.push(structuredClone(p)); return respostas.shift(); } } } };

  const r = await cerebro.conversar("c1", "gastei 30 no almoço");
  assert.equal(r.texto, "Anotado: R$ 30,00 no almoço.");
  assert.deepEqual(r.acoes, ["registrar_transacao"]);
  assert.equal(banco.resumoFinanceiro().saidas, 30);

  // A segunda chamada contém a resposta anterior sem alterações + o resultado da ferramenta.
  const msgs = pedidos[1].messages;
  assert.equal(msgs[1].content[0].signature, "abc");
  assert.equal(msgs[2].content[0].type, "tool_result");
  assert.equal(pedidos[0].model, "claude-opus-5-5");
  assert.equal(pedidos[0].fallbacks, "default");
});

test("cérebro: recusa e erro não deixam histórico pela metade", async () => {
  const cerebro = new Cerebro(criarFerramentas(novoBanco()));
  cerebro.cliente = { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } };
  const r = await cerebro.conversar("c2", "algo");
  assert.match(r.texto, /não posso/);
  assert.equal(cerebro.historico("c2").length, 0);

  cerebro.cliente = { beta: { messages: { create: async () => { throw new Error("rede"); } } } };
  await assert.rejects(cerebro.conversar("c2", "oi"));
  assert.equal(cerebro.historico("c2").length, 0);
});
