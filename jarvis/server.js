// Servidor do Jarvis: entrega a interface e a API de conversa.
process.env.TZ ||= "America/Sao_Paulo";

import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Banco } from "./src/db.js";
import { criarFerramentas } from "./src/ferramentas.js";
import { Cerebro } from "./src/cerebro.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT || 3000);
const SENHA = process.env.JARVIS_SENHA || "";

const banco = new Banco(process.env.JARVIS_DADOS || path.join(aqui, "dados", "jarvis.json"));
const cerebro = new Cerebro(criarFerramentas(banco));

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(aqui, "public")));

// Senha opcional (recomendada se o Jarvis ficar na internet).
app.use("/api", (req, res, next) => {
  if (!SENHA) return next();
  const enviada = Buffer.from(String(req.get("x-jarvis-senha") || ""));
  const certa = Buffer.from(SENHA);
  if (enviada.length === certa.length && crypto.timingSafeEqual(enviada, certa)) return next();
  res.status(401).json({ erro: "Senha incorreta" });
});

// Uma pergunta por vez em cada conversa, para não embaralhar o histórico.
const filas = new Map();
function naFila(id, tarefa) {
  const anterior = filas.get(id) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(tarefa);
  filas.set(id, atual);
  atual.finally(() => filas.get(id) === atual && filas.delete(id)).catch(() => {}); // o erro é tratado na rota
  return atual;
}

app.get("/api/status", (_req, res) => res.json({ ok: true, senha: Boolean(SENHA) }));

app.post("/api/conversar", async (req, res) => {
  const { conversa, texto } = req.body || {};
  if (typeof conversa !== "string" || typeof texto !== "string" || !texto.trim()) {
    return res.status(400).json({ erro: "Envie 'conversa' e 'texto'." });
  }
  try {
    const resultado = await naFila(conversa, () => cerebro.conversar(conversa, texto.trim().slice(0, 4000)));
    res.json(resultado);
  } catch (erro) {
    console.error(erro);
    let mensagem = "Tive um problema para pensar agora. Tente de novo em instantes.";
    const semChave = !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
    if (erro instanceof Anthropic.AuthenticationError || (semChave && !(erro instanceof Anthropic.APIError))) mensagem = "A chave da API da Anthropic está faltando ou é inválida.";
    else if (erro instanceof Anthropic.RateLimitError) mensagem = "Muitas perguntas seguidas. Espere um pouco e tente de novo.";
    else if (erro instanceof Anthropic.APIConnectionError) mensagem = "Não consegui me conectar ao servidor da IA.";
    res.status(500).json({ erro: mensagem });
  }
});

app.post("/api/conversa/limpar", (req, res) => {
  cerebro.limpar(String(req.body?.conversa || ""));
  res.json({ ok: true });
});

// Dados para os painéis da interface.
app.get("/api/painel", (_req, res) => {
  res.json({
    notas: banco.listarNotas().slice(0, 20),
    lembretes: banco.listarLembretes().slice(0, 20),
    financas: banco.resumoFinanceiro(),
    transacoes: banco.listarTransacoes({ limite: 10 }),
  });
});

// A interface consulta isto a cada poucos segundos para avisar lembretes.
app.get("/api/lembretes/vencidos", (_req, res) => {
  res.json(banco.lembretesVencidos());
});

app.listen(PORTA, () => {
  console.log(`Jarvis online em http://localhost:${PORTA}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Aviso: ANTHROPIC_API_KEY não definida. Crie o arquivo .env (veja .env.exemplo).");
  }
});
