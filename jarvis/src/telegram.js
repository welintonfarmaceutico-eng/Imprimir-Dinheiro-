// Conversar com o Jarvis pelo Telegram (funciona no Android Auto: o carro lê as respostas em voz alta).
// Precisa de TELEGRAM_BOT_TOKEN (o token que o @BotFather entrega). Só o dono usa: o chat é ligado
// com um código de uso único gerado em Ajustes; mensagens de qualquer outro chat são ignoradas.
import crypto from "node:crypto";
import { hojeLocal } from "./fuso.js";

const API = "https://api.telegram.org";
const VALIDADE_CODIGO_MS = 15 * 60 * 1000;

export class Telegram {
  constructor(armazem, { fetch: f = (...a) => globalThis.fetch(...a), env = process.env } = {}) {
    this.armazem = armazem;
    this.fetch = f;
    this.token = (env.TELEGRAM_BOT_TOKEN || "").trim();
  }

  get configurado() {
    return Boolean(this.token);
  }

  // Senha que o Telegram manda em cada aviso ao webhook (derivada do token, sem precisar de outra variável).
  get segredoWebhook() {
    return crypto.createHmac("sha256", this.token).update("jarvis-webhook").digest("hex").slice(0, 48);
  }

  confereSegredo(recebido) {
    const a = Buffer.from(String(recebido ?? "")), b = Buffer.from(this.segredoWebhook);
    return this.configurado && a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async api(metodo, corpo = {}) {
    if (!this.configurado) throw new Error("Telegram não configurado: falta TELEGRAM_BOT_TOKEN.");
    const resp = await this.fetch(`${API}/bot${this.token}/${metodo}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const dados = await resp.json().catch(() => ({}));
    if (!dados.ok) throw new Error(`O Telegram recusou (${metodo}): ${dados.description || resp.status}`);
    return dados.result;
  }

  // Canal de avisos (lembretes, resumo, relatório), no mesmo formato do WhatsApp.
  // No carro, é só responder por voz a essas mensagens para falar com o Jarvis.
  async canal() {
    const chatId = (await this.armazem.obter("config", "telegram"))?.chatId;
    return { nome: "telegram", configurado: Boolean(this.configurado && chatId), enviar: (texto) => this.enviar(chatId, texto) };
  }

  async estado() {
    const conf = await this.armazem.obter("config", "telegram");
    return { configurado: this.configurado, conectado: Boolean(conf?.chatId), bot: conf?.bot || null };
  }

  // Liga o webhook neste endereço e gera um código para o dono abrir o robô.
  async conectar(origem) {
    const eu = await this.api("getMe");
    await this.api("setWebhook", {
      url: `${String(origem).replace(/\/+$/, "")}/api/telegram/webhook`,
      secret_token: this.segredoWebhook,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
    const codigo = crypto.randomBytes(6).toString("hex");
    await this.armazem.salvar("config", "telegram-codigo", { codigo, expira: Date.now() + VALIDADE_CODIGO_MS });
    const conf = (await this.armazem.obter("config", "telegram")) || {};
    await this.armazem.salvar("config", "telegram", { ...conf, bot: eu.username });
    return { bot: eu.username, link: `https://t.me/${eu.username}?start=${codigo}` };
  }

  async desconectar() {
    if (this.configurado) await this.api("deleteWebhook").catch(() => {});
    await this.armazem.apagar("config", "telegram");
    await this.armazem.apagar("config", "telegram-codigo");
  }

  async enviar(chatId, texto, botoes = []) {
    const teclado = botoes.filter((b) => /^https?:/i.test(b.url)).map((b) => [{ text: b.rotulo, url: b.url }]);
    const extras = botoes.filter((b) => /^(tel|sms):/.test(b.url)).map((b) => `${b.rotulo}: ${b.url.replace(/^(tel|sms):/, "").split("?")[0]}`);
    const limpo = String(texto ?? "").replace(/\[\/?en\]/gi, ""); // marcas de voz em inglês não aparecem no Telegram
    const corpo = { chat_id: chatId, text: [limpo, ...extras].join("\n").slice(0, 4000) || "Pronto." };
    if (teclado.length) corpo.reply_markup = { inline_keyboard: teclado };
    return this.api("sendMessage", corpo);
  }

  async #baixarArquivo(fileId, tipo) {
    const arquivo = await this.api("getFile", { file_id: fileId });
    const resp = await this.fetch(`${API}/file/bot${this.token}/${arquivo.file_path}`);
    if (!resp.ok) throw new Error("Não consegui baixar o arquivo do Telegram.");
    return { imagem: Buffer.from(await resp.arrayBuffer()).toString("base64"), tipo };
  }

  // O Telegram manda vários tamanhos da foto; o último é o maior (até 1280 px).
  #baixarFoto(fotos) {
    return this.#baixarArquivo(fotos.at(-1).file_id, "image/jpeg");
  }

  // Responde no chat com o texto, os botões e os documentos/posts que vieram na resposta.
  async #responder(chatId, r) {
    await this.enviar(chatId, r.texto, r.botoes || []);
    for (const p of r.posts || []) {
      if (p.titulo) {
        // Documento: pode ser longo; vai em partes de até 3.800 caracteres, cortando em quebra de linha.
        for (const parte of partes(`${p.titulo}\n\n${p.texto}`, 3800)) await this.enviar(chatId, parte);
      } else {
        await this.enviar(chatId, p.texto, [{ rotulo: "Abrir o Instagram", url: "https://www.instagram.com/" }]);
      }
    }
  }

  // Trata uma mensagem que chegou ao robô. "jarvis" traz { conversar(conversa, texto, anexo), notaFiscal(foto) }.
  async processar(atualizacao, jarvis) {
    const msg = atualizacao?.message;
    if (!msg?.chat?.id) return;
    // Cada atualização é tratada uma vez só (o Telegram reenvia se a resposta demorar).
    const idAtualizacao = String(atualizacao.update_id);
    if (await this.armazem.obter("telegram-recebidas", idAtualizacao)) return;
    await this.armazem.salvar("telegram-recebidas", idAtualizacao, { em: Date.now() });

    const chatId = msg.chat.id;
    const conf = (await this.armazem.obter("config", "telegram")) || {};
    const texto = String(msg.text ?? msg.caption ?? "").trim();

    // Ligação com o código de Ajustes ("/start codigo", vindo do link, ou o código sozinho).
    const codigoEnviado = texto.replace(/^\/start\s*/i, "").trim();
    const pendente = await this.armazem.obter("config", "telegram-codigo");
    if (pendente && codigoEnviado && codigoEnviado === pendente.codigo && Date.now() < pendente.expira) {
      await this.armazem.salvar("config", "telegram", { ...conf, chatId, nome: msg.from?.first_name || "" });
      await this.armazem.apagar("config", "telegram-codigo");
      await this.enviar(chatId, "Pronto, Telegram conectado! Pode falar comigo por aqui, inclusive pelo Android Auto. Mande também a foto de uma nota fiscal que eu anoto o gasto.");
      return;
    }
    if (String(conf.chatId) !== String(chatId)) {
      if (texto.startsWith("/start")) await this.enviar(chatId, "Este Jarvis é particular. Para conectar, use o botão em Ajustes, no próprio Jarvis.");
      return; // estranhos são ignorados
    }

    await this.api("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    try {
      const conversa = `telegram-${hojeLocal()}`; // conversa nova a cada dia (mais barato)
      const pdf = msg.document?.mime_type === "application/pdf" ? msg.document : null;
      const imagemComoArquivo = /^image\/(jpeg|png|webp)$/.test(msg.document?.mime_type || "") ? msg.document : null;
      if (pdf || imagemComoArquivo) {
        // PDF ou foto mandada como arquivo: analisa o documento (com a pergunta da legenda, se houver).
        const doc = pdf || imagemComoArquivo;
        const anexo = await this.#baixarArquivo(doc.file_id, doc.mime_type);
        await this.#responder(chatId, await jarvis.conversar(conversa, texto || "Analise este documento e me oriente.", anexo));
      } else if (msg.photo?.length) {
        const foto = await this.#baixarFoto(msg.photo);
        if (texto) {
          // Foto com legenda: análise do documento, respondendo à pergunta da legenda.
          await this.#responder(chatId, await jarvis.conversar(conversa, texto, foto));
        } else {
          // Foto sem legenda: tenta como nota fiscal; se não for, analisa como documento.
          const r = await jarvis.notaFiscal(foto);
          if (r.transacao) await this.enviar(chatId, r.texto);
          else await this.#responder(chatId, await jarvis.conversar(conversa, "Analise este documento e me oriente.", foto));
        }
      } else if (texto) {
        await this.#responder(chatId, await jarvis.conversar(conversa, texto));
      } else {
        await this.enviar(chatId, "Por enquanto eu entendo texto, fotos (nota fiscal ou documento) e PDF. No carro, dite a mensagem que o Android Auto transforma em texto.");
      }
    } catch (erro) {
      await this.enviar(chatId, erro.mensagemParaUsuario || erro.message || "Tive um problema agora. Tente de novo.").catch(() => {});
    }
  }
}

// Divide um texto longo em pedaços, de preferência numa quebra de linha.
export function partes(texto, max) {
  const saida = [];
  let resto = String(texto);
  while (resto.length > max) {
    let corte = resto.lastIndexOf("\n", max);
    if (corte < max * 0.5) corte = max;
    saida.push(resto.slice(0, corte).trimEnd());
    resto = resto.slice(corte).replace(/^\n+/, "");
  }
  if (resto.trim()) saida.push(resto);
  return saida;
}
