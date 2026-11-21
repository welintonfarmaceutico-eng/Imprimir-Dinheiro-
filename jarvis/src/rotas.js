// API do Jarvis no formato padrão da web (Request -> Response).
// Usada tanto pelo servidor local (server.js) quanto pela função do Netlify.
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Banco } from "./db.js";
import { criarFerramentas } from "./ferramentas.js";
import { Cerebro } from "./cerebro.js";

const json = (dados, status = 200) => Response.json(dados, { status });
const ID_VALIDO = /^[A-Za-z0-9-]{1,64}$/;

// Fuso horário dos lembretes e das datas. (TZ é reservado no Netlify, por isso JARVIS_FUSO.)
export function definirFuso() {
  process.env.TZ = process.env.JARVIS_FUSO || "America/Sao_Paulo";
}

export function criarJarvis(armazem, { senha = process.env.JARVIS_SENHA || "" } = {}) {
  definirFuso();
  const banco = new Banco(armazem);
  const cerebro = new Cerebro(criarFerramentas(banco), banco);

  function autorizado(req) {
    if (!senha) return true;
    const enviada = Buffer.from(req.headers.get("x-jarvis-senha") || "");
    const certa = Buffer.from(senha);
    return enviada.length === certa.length && crypto.timingSafeEqual(enviada, certa);
  }

  async function corpo(req) {
    try {
      return await req.json();
    } catch {
      return {};
    }
  }

  async function conversar(req) {
    const { conversa, texto } = await corpo(req);
    if (typeof conversa !== "string" || !ID_VALIDO.test(conversa) || typeof texto !== "string" || !texto.trim()) {
      return json({ erro: "Envie 'conversa' e 'texto'." }, 400);
    }
    try {
      return json(await cerebro.conversar(conversa, texto.trim().slice(0, 4000)));
    } catch (erro) {
      console.error(erro);
      const semChave = !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
      let mensagem = "Tive um problema para pensar agora. Tente de novo em instantes.";
      if (erro instanceof Anthropic.AuthenticationError || (semChave && !(erro instanceof Anthropic.APIError))) {
        mensagem = "A chave da API da Anthropic está faltando ou é inválida.";
      } else if (erro instanceof Anthropic.RateLimitError) {
        mensagem = "Muitas perguntas seguidas. Espere um pouco e tente de novo.";
      } else if (erro instanceof Anthropic.APIConnectionError) {
        mensagem = "Não consegui me conectar ao servidor da IA.";
      }
      return json({ erro: mensagem }, 500);
    }
  }

  return async function tratar(req) {
    const { pathname } = new URL(req.url);
    const rota = `${req.method} ${pathname.replace(/\/+$/, "")}`;

    if (rota === "GET /api/status") return json({ ok: true, senha: Boolean(senha) });
    if (!autorizado(req)) return json({ erro: "Senha incorreta" }, 401);

    switch (rota) {
      case "POST /api/conversar":
        return conversar(req);
      case "POST /api/conversa/limpar": {
        const { conversa } = await corpo(req);
        if (typeof conversa === "string" && ID_VALIDO.test(conversa)) await cerebro.limpar(conversa);
        return json({ ok: true });
      }
      case "GET /api/painel": {
        const [notas, lembretes, financas, transacoes] = await Promise.all([
          banco.listarNotas(),
          banco.listarLembretes(),
          banco.resumoFinanceiro(),
          banco.listarTransacoes({ limite: 10 }),
        ]);
        return json({ notas: notas.slice(0, 20), lembretes: lembretes.slice(0, 20), financas, transacoes });
      }
      case "GET /api/lembretes/vencidos":
        return json(await banco.lembretesVencidos());
      default:
        return json({ erro: "Rota não encontrada" }, 404);
    }
  };
}
