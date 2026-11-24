// API do Jarvis no formato padrão da web (Request -> Response).
// Usada tanto pelo servidor local (server.js) quanto pela função do Netlify.
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Banco } from "./db.js";
import { inicioDoDia } from "./fuso.js";
import { criarFerramentas, criarFerramentasEstudante } from "./ferramentas.js";
import { Cerebro, promptEstudante } from "./cerebro.js";
import { GoogleAgenda } from "./google.js";
import { WhatsApp, enviarLembretesVencidos } from "./whatsapp.js";
import { Computador } from "./computador.js";
import { alterarResumo, enviarRelatorioMensal, enviarResumoDiario, montarResumo } from "./resumo.js";
import { Clima } from "./clima.js";
import { registrarNotaFiscal, validarImagem } from "./notaFiscal.js";
import { Telegram } from "./telegram.js";
import { Instagram } from "./instagram.js";
import { Toledo } from "./toledo.js";

const json = (dados, status = 200) => Response.json(dados, { status });
const ID_VALIDO = /^[A-Za-z0-9-]{1,64}$/;

// Fuso horário dos lembretes e das datas. (TZ é reservado no Netlify, por isso JARVIS_FUSO.)
export function definirFuso() {
  process.env.TZ = process.env.JARVIS_FUSO || "America/Sao_Paulo";
}

// Traduz os erros da API da Anthropic em mensagens claras.
// "credito: true" quando o problema é saldo ou limite de gasto (para avisar no WhatsApp).
export function explicarErro(erro) {
  const semChave = !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
  if (erro instanceof Anthropic.AuthenticationError || (semChave && !(erro instanceof Anthropic.APIError))) {
    return { mensagem: "A chave da API da Anthropic está faltando ou é inválida." };
  }
  if (erro instanceof Anthropic.APIError) {
    // Sem crédito: 402 billing_error, ou 400 com "credit balance is too low" (para esse caso a API não tem código próprio).
    if (erro.status === 402 || erro.type === "billing_error" || /credit balance/i.test(erro.apiMessage ?? erro.message)) {
      return {
        credito: true,
        mensagem: "Seus créditos da Anthropic acabaram. Recarregue em console.anthropic.com, em Settings, Billing.",
      };
    }
    if (erro.errorCode === "enforced_spend_limit_reached") {
      return {
        credito: true,
        mensagem: "O limite de gasto do mês da Anthropic foi atingido. Aumente o limite em console.anthropic.com, em Settings, Limits.",
      };
    }
  }
  if (erro instanceof Anthropic.RateLimitError) return { mensagem: "Muitas perguntas seguidas. Espere um pouco e tente de novo." };
  if (erro instanceof Anthropic.APIConnectionError) return { mensagem: "Não consegui me conectar ao servidor da IA." };
  if (erro instanceof Anthropic.InternalServerError) return { mensagem: "O servidor da IA está ocupado agora. Tente de novo em instantes." };
  return { mensagem: "Tive um problema para pensar agora. Tente de novo em instantes." };
}

export function criarJarvis(armazem, { senha = process.env.JARVIS_SENHA || "", senhaEstudante = process.env.JARVIS_SENHA_ESTUDANTE || "", cliente = null, computadorOpcoes = {}, telegramOpcoes = {} } = {}) {
  definirFuso();
  const banco = new Banco(armazem);
  const agenda = new GoogleAgenda(armazem);
  const whatsapp = new WhatsApp();
  const computador = new Computador(armazem, computadorOpcoes);
  const toledo = new Toledo();
  const clima = new Clima(armazem);
  const telegram = new Telegram(armazem, telegramOpcoes);
  const instagram = new Instagram(armazem);
  const cerebro = new Cerebro(criarFerramentas(banco, agenda, whatsapp, computador, toledo, clima, instagram), banco);
  // Modo Escola: professor particular, sem nenhuma ferramenta do adulto (finanças, Toledo, PC, WhatsApp...).
  const cerebroEstudante = new Cerebro(criarFerramentasEstudante(), banco, { sistema: promptEstudante() });
  if (cliente) cerebro.cliente = cerebroEstudante.cliente = cliente; // só nos testes

  const confere = (enviada, certa) => {
    const a = Buffer.from(enviada), b = Buffer.from(certa);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  // Quem está usando: "adulto" (senha do Jarvis), "estudante" (senha do Modo Escola) ou ninguém.
  function perfil(req) {
    const enviada = req.headers.get("x-jarvis-senha") || "";
    if (!senha) return "adulto";
    if (confere(enviada, senha)) return "adulto";
    if (senhaEstudante && confere(enviada, senhaEstudante)) return "estudante";
    return null;
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
      return json(await cerebro.conversar(conversa, texto.trim().slice(0, 4000), null, { aparelho: req.headers.get("x-jarvis-aparelho") || "" }));
    } catch (erro) {
      console.error(erro);
      const { mensagem, credito } = explicarErro(erro);
      if (credito) await avisarCreditoNoWhatsApp(mensagem);
      return json({ erro: mensagem }, 500);
    }
  }

  // Mesma conversa, mas a resposta vai chegando em tempo real (Server-Sent Events).
  async function conversarAoVivo(req, cer = cerebro, prefixo = "") {
    const { conversa, texto: textoEnviado, aparelho, imagem, tipo } = await corpo(req);
    const anexo = imagem ? { imagem, tipo } : null;
    const texto = typeof textoEnviado === "string" && textoEnviado.trim() ? textoEnviado : anexo ? "Analise este documento e me oriente." : "";
    if (typeof conversa !== "string" || !ID_VALIDO.test(conversa) || !texto.trim()) {
      return json({ erro: "Envie 'conversa' e 'texto'." }, 400);
    }
    if (anexo) {
      try { validarImagem(anexo, { aceitarPdf: true }); } catch (erro) { return json({ erro: erro.message }, 400); }
    }
    const codificador = new TextEncoder();
    const fluxo = new ReadableStream({
      async start(controle) {
        const enviar = (evento) => controle.enqueue(codificador.encode(`data: ${JSON.stringify(evento)}\n\n`));
        try {
          const r = await cer.conversar(prefixo + conversa, texto.trim().slice(0, 4000), (delta) => enviar({ tipo: "texto", delta }), { aparelho, anexo });
          enviar({ tipo: "fim", ...r });
        } catch (erro) {
          console.error(erro);
          const { mensagem, credito } = explicarErro(erro);
          if (credito) await avisarCreditoNoWhatsApp(mensagem);
          enviar({ tipo: "erro", mensagem });
        }
        controle.close();
      },
    });
    return new Response(fluxo, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
  }

  // Botões rápidos da tela: salvam direto, sem passar pela IA (custo zero).
  async function adicionarRapido(rota, dados) {
    try {
      if (rota === "POST /api/notas") {
        if (typeof dados.texto !== "string" || !dados.texto.trim()) throw new Error("Escreva a nota.");
        return json(await banco.adicionarNota(dados.texto.trim().slice(0, 2000)));
      }
      if (rota === "POST /api/transacoes") {
        const valor = Number(String(dados.valor ?? "").replace(",", "."));
        return json(await banco.adicionarTransacao({
          tipo: dados.tipo,
          valor,
          categoria: String(dados.categoria || "outros").slice(0, 40),
          descricao: String(dados.descricao || "").slice(0, 200),
        }));
      }
      if (rota === "POST /api/lembretes") {
        if (typeof dados.texto !== "string" || !dados.texto.trim()) throw new Error("Escreva o lembrete.");
        return json(await banco.adicionarLembrete(dados.texto.trim().slice(0, 500), dados.quando, dados.repetir));
      }
    } catch (erro) {
      return json({ erro: erro.message }, 400);
    }
  }

  // Avisa no WhatsApp que o crédito acabou, no máximo uma vez a cada 24 horas.
  async function avisarCreditoNoWhatsApp(mensagem) {
    if (!whatsapp.configurado) return;
    try {
      const ultimo = await armazem.obter("config", "aviso-credito");
      if (ultimo && Date.now() - ultimo.em < 24 * 60 * 60 * 1000) return;
      await whatsapp.enviar(`⚠️ Jarvis: ${mensagem}`);
      await armazem.salvar("config", "aviso-credito", { em: Date.now() });
    } catch (e) {
      console.error("Aviso de crédito no WhatsApp:", e.message);
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

    // Mensagens do robô do Telegram: protegidas pela senha que o próprio Telegram manda no cabeçalho.
    if (rota === "POST /api/telegram/webhook") {
      if (!telegram.confereSegredo(req.headers.get("x-telegram-bot-api-secret-token"))) return json({ erro: "não autorizado" }, 401);
      const atualizacao = await corpo(req);
      // Erros da IA viram mensagens claras no Telegram (crédito acabou, serviço ocupado...).
      const comAviso = (fn) => async (...args) => {
        try {
          return await fn(...args);
        } catch (erro) {
          if (erro instanceof Anthropic.APIError || !(erro instanceof Error)) {
            console.error(erro);
            const { mensagem, credito } = explicarErro(erro);
            if (credito) await avisarCreditoNoWhatsApp(mensagem);
            erro.mensagemParaUsuario = mensagem;
          }
          throw erro;
        }
      };
      try {
        await telegram.processar(atualizacao, {
          conversar: comAviso((conversa, texto, anexo = null) => cerebro.conversar(conversa, texto.slice(0, 4000), null, { aparelho: "celular", anexo })),
          notaFiscal: comAviso((foto) => registrarNotaFiscal(cerebro.cliente, banco, foto)),
        });
      } catch (erro) {
        console.error("Telegram:", erro); // responde 200 mesmo assim, para o Telegram não repetir
      }
      return json({ ok: true });
    }

    // O programa do PC não usa a senha do Jarvis: cada pedido vem assinado com a chave do PC.
    if (rota === "GET /api/pc/esperar") {
      try {
        const ordem = await computador.esperarOrdem({ ts: url.searchParams.get("ts"), sig: url.searchParams.get("sig") });
        return ordem ? json(ordem) : new Response(null, { status: 204 });
      } catch (erro) {
        if (erro.message === "nao_autorizado") return json({ erro: "Chave do PC inválida" }, 401);
        throw erro;
      }
    }
    if (rota === "POST /api/pc/resposta") {
      try {
        await computador.receberResposta(await req.json());
        return json({ ok: true });
      } catch (erro) {
        if (erro.message === "nao_autorizado") return json({ erro: "Chave do PC inválida" }, 401);
        return json({ erro: "Resposta inválida" }, 400);
      }
    }

    const quem = perfil(req);
    if (!quem) return json({ erro: "Senha incorreta" }, 401);
    if (rota === "GET /api/perfil") return json({ perfil: quem });
    if (quem === "estudante") {
      // Modo Escola: só a conversa com o professor (com foto do exercício). O resto é bloqueado.
      if (rota === "POST /api/conversar/ao-vivo") return conversarAoVivo(req, cerebroEstudante, "escola-");
      if (rota === "POST /api/conversa/limpar") {
        const { conversa } = await corpo(req);
        if (typeof conversa === "string" && ID_VALIDO.test(conversa)) await cerebroEstudante.limpar("escola-" + conversa);
        return json({ ok: true });
      }
      return json({ erro: "Disponível só no modo adulto." }, 403);
    }

    switch (rota) {
      case "POST /api/conversar":
        return conversar(req);
      case "POST /api/conversar/ao-vivo":
        return conversarAoVivo(req);
      case "POST /api/notas":
      case "POST /api/transacoes":
      case "POST /api/lembretes":
        return adicionarRapido(rota, await corpo(req));
      case "POST /api/nota-fiscal": {
        const { imagem, tipo } = await corpo(req);
        try {
          return json(await registrarNotaFiscal(cerebro.cliente, banco, { imagem, tipo }));
        } catch (erro) {
          if (!(erro instanceof Anthropic.APIError)) return json({ erro: erro.message }, 400);
          console.error(erro);
          const { mensagem, credito } = explicarErro(erro);
          if (credito) await avisarCreditoNoWhatsApp(mensagem);
          return json({ erro: mensagem }, 500);
        }
      }
      case "POST /api/transacoes/apagar": {
        const { id } = await corpo(req);
        if (typeof id !== "string" || !ID_VALIDO.test(id)) return json({ erro: "id inválido" }, 400);
        return json({ apagada: await banco.apagarTransacao(id) });
      }
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
        const inicio = inicioDoDia();
        const fim = inicioDoDia(new Date(), 2); // hoje e amanhã
        try {
          return json({ conectado: true, eventos: await agenda.listarEventos(inicio, fim) });
        } catch (erro) {
          return json({ conectado: await agenda.conectado(), eventos: [], erro: erro.message });
        }
      }
      case "GET /api/hoje": {
        // Resumo rápido para o topo da tela: tempo, próximo lembrete, próximo compromisso e atrasos.
        const agora = new Date();
        const [previsao, lembretes, evento, carteira] = await Promise.all([
          clima.previsaoDeHoje(agora).catch(() => null),
          banco.listarLembretes().catch(() => []),
          (async () => {
            if (!agenda.configurado || !(await agenda.conectado())) return null;
            const eventos = await agenda.listarEventos(agora, new Date(agora.getTime() + 2 * 24 * 3600 * 1000));
            return eventos.find((e) => e.diaInteiro || new Date(e.fim || e.inicio) > agora) || null;
          })().catch(() => null),
          toledo.configurado ? toledo.carteira().catch(() => null) : null,
        ]);
        return json({
          previsao,
          proximoLembrete: lembretes.find((l) => new Date(l.quando) > agora) || null,
          proximoEvento: evento,
          toledo: carteira ? { atrasos: carteira.emAtraso.quantidade, totalAtraso: carteira.emAtraso.total, vencendo: carteira.vencendoEm7Dias.quantidade } : null,
        });
      }
      case "GET /api/toledo/painel":
        if (!toledo.configurado) return json({ configurado: false });
        try {
          return json({ configurado: true, ...(await toledo.carteira()) });
        } catch (erro) {
          return json({ configurado: true, erro: erro.message });
        }
      case "GET /api/instagram/status":
        if (!instagram.configurado) return json({ configurado: false });
        try {
          return json({ configurado: true, conta: (await instagram.conta()).username });
        } catch (erro) {
          return json({ configurado: true, erro: erro.message });
        }
      case "GET /api/telegram/status":
        return json(await telegram.estado());
      case "POST /api/telegram/conectar":
        try {
          return json(await telegram.conectar(url.origin));
        } catch (erro) {
          return json({ erro: erro.message }, 400);
        }
      case "POST /api/telegram/desconectar":
        await telegram.desconectar();
        return json({ ok: true });
      case "GET /api/resumo":
        return json(await alterarResumo(armazem, { acao: "ver" }));
      case "POST /api/resumo":
        try {
          const { acao, hora } = await corpo(req);
          return json(await alterarResumo(armazem, { acao, hora: Number(hora) }));
        } catch (erro) {
          return json({ erro: erro.message }, 400);
        }
      case "GET /api/whatsapp/status":
        return json({ configurado: whatsapp.configurado });
      case "POST /api/whatsapp/teste":
        try {
          // O teste manda o próprio resumo do dia: serve de teste e de resumo na hora.
          const resumo = await montarResumo(banco, agenda, new Date(), toledo, clima, instagram);
          const canalTelegram = await telegram.canal(); // no Telegram também, para responder no carro
          if (canalTelegram.configurado) await canalTelegram.enviar(resumo).catch((e) => console.error("Telegram, resumo:", e.message));
          return json(await whatsapp.enviar(resumo));
        } catch (erro) {
          return json({ erro: erro.message }, 400);
        }
      case "GET /api/pc/status":
        return json({ conectado: await computador.configurado(), online: await computador.online() });
      case "GET /api/pc/instalador":
        return new Response(await computador.instalador(url.origin), {
          headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="jarvis-pc.ps1"', "cache-control": "no-store" },
        });
      case "POST /api/pc/testar":
        try {
          return json(await computador.executar("ping"));
        } catch (erro) {
          return json({ erro: erro.message }, 400);
        }
      case "POST /api/pc/desconectar":
        await computador.desconectar();
        return json({ ok: true });
      case "GET /api/lembretes/vencidos":
        return json(await banco.lembretesVencidos());
      default:
        return json({ erro: "Rota não encontrada" }, 404);
    }
  };
}

// Usada a cada minuto (função agendada do Netlify, ou o relógio do servidor local).
// Manda os lembretes que venceram e, na hora marcada, o resumo do dia.
export async function verificarLembretesWhatsApp(armazem) {
  definirFuso();
  const banco = new Banco(armazem);
  const whatsapp = new WhatsApp();
  const telegram = await new Telegram(armazem).canal(); // os avisos também vão para o Telegram, se conectado
  const resultado = await enviarLembretesVencidos(banco, armazem, whatsapp);
  await enviarLembretesVencidos(banco, armazem, telegram).catch((e) => console.error("Telegram, lembretes:", e.message));
  await banco.avancarRepetidos(); // lembretes que se repetem passam para a próxima vez
  // Comentários e mensagens novas no Instagram (confere a cada 5 minutos).
  const instagram = new Instagram(armazem);
  const insta = await instagram.verificar([whatsapp, telegram]).catch((e) => (console.error("Instagram:", e.message), { avisos: 0 }));
  const agenda = new GoogleAgenda(armazem), toledo = new Toledo(), clima = new Clima(armazem);
  const resumo = await enviarResumoDiario(banco, armazem, whatsapp, agenda, new Date(), undefined, toledo, clima, instagram);
  await enviarResumoDiario(banco, armazem, telegram, agenda, new Date(), undefined, toledo, clima, instagram);
  const relatorio = await enviarRelatorioMensal(banco, armazem, whatsapp);
  await enviarRelatorioMensal(banco, armazem, telegram);
  return { ...resultado, resumo: resumo.enviado, relatorio: relatorio.enviado, instagram: insta.avisos };
}
