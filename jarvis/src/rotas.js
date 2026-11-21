// API do Jarvis no formato padrão da web (Request -> Response).
// Usada tanto pelo servidor local (server.js) quanto pela função do Netlify.
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Banco } from "./db.js";
import { criarFerramentas } from "./ferramentas.js";
import { Cerebro } from "./cerebro.js";
import { GoogleAgenda } from "./google.js";
import { WhatsApp, enviarLembretesVencidos } from "./whatsapp.js";

const json = (dados, status = 200) => Response.json(dados, { status });
const ID_VALIDO = /^[A-Za-z0-9-]{1,64}$/;

// Fuso horário dos lembretes e das datas. (TZ é reservado no Netlify, por isso JARVIS_FUSO.)
export function definirFuso() {
  process.env.TZ = process.env.JARVIS_FUSO || "America/Sao_Paulo";
}

export function criarJarvis(armazem, { senha = process.env.JARVIS_SENHA || "" } = {}) {
  definirFuso();
  const banco = new Banco(armazem);
  const agenda = new GoogleAgenda(armazem);
  const whatsapp = new WhatsApp();
  const cerebro = new Cerebro(criarFerramentas(banco, agenda, whatsapp), banco);

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

  const paginaGoogle = (mensagem, ok) =>
    new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<meta http-equiv="refresh" content="${ok ? 2 : 6};url=/"><body style="background:#03080f;color:#d6f6ff;font-family:sans-serif;padding:24px">` +
        `<h2>${ok ? "Google Agenda conectado!" : "Não deu certo"}</h2><p>${mensagem}</p><p><a style="color:#00d4ff" href="/">Voltar ao Jarvis</a></p>`,
      { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  const escapar = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  return async function tratar(req) {
    const url = new URL(req.url);
    const rota = `${req.method} ${url.pathname.replace(/\/+$/, "")}`;

    if (rota === "GET /api/status") return json({ ok: true, senha: Boolean(senha) });

    // Volta do Google depois de autorizar. Não usa a senha do Jarvis: é protegida pelo "state" de uso único.
    if (rota === "GET /api/google/retorno") {
      if (url.searchParams.get("error")) return paginaGoogle("A permissão foi cancelada no Google.", false);
      try {
        await agenda.concluirConexao(url.searchParams.get("code"), url.searchParams.get("state"));
        return paginaGoogle("Pode voltar e pedir: \"o que tenho na agenda amanhã?\"", true);
      } catch (erro) {
        console.error(erro);
        return paginaGoogle(escapar(erro.message), false);
      }
    }

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
      case "GET /api/google/status":
        return json({ configurado: agenda.configurado, conectado: agenda.configurado && (await agenda.conectado()) });
      case "POST /api/google/link":
        try {
          return json({ url: await agenda.linkDeConexao(`${url.origin}/api/google/retorno`) });
        } catch (erro) {
          return json({ erro: erro.message }, 400);
        }
      case "POST /api/google/desconectar":
        await agenda.desconectar();
        return json({ ok: true });
      case "GET /api/agenda/hoje": {
        if (!agenda.configurado || !(await agenda.conectado())) return json({ conectado: false, eventos: [] });
        const inicio = new Date();
        inicio.setHours(0, 0, 0, 0);
        const fim = new Date(inicio.getTime() + 2 * 24 * 60 * 60 * 1000); // hoje e amanhã
        try {
          return json({ conectado: true, eventos: await agenda.listarEventos(inicio, fim) });
        } catch (erro) {
          return json({ conectado: await agenda.conectado(), eventos: [], erro: erro.message });
        }
      }
      case "GET /api/whatsapp/status":
        return json({ configurado: whatsapp.configurado });
      case "POST /api/whatsapp/teste":
        try {
          return json(await whatsapp.enviar("✅ Teste do Jarvis: os lembretes vão chegar aqui."));
        } catch (erro) {
          return json({ erro: erro.message }, 400);
        }
      case "GET /api/lembretes/vencidos":
        return json(await banco.lembretesVencidos());
      default:
        return json({ erro: "Rota não encontrada" }, 404);
    }
  };
}

// Usada a cada minuto (função agendada do Netlify, ou o relógio do servidor local).
export async function verificarLembretesWhatsApp(armazem) {
  definirFuso();
  return enviarLembretesVencidos(new Banco(armazem), armazem, new WhatsApp());
}
