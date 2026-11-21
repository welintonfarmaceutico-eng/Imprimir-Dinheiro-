// Google Agenda: conexão (OAuth) e acesso aos eventos da agenda principal.
// Precisa de GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (veja o README).
import crypto from "node:crypto";
import { fuso, lerData } from "./fuso.js";

const AUTORIZAR = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const EVENTOS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const ESCOPO = "https://www.googleapis.com/auth/calendar.events";
const VALIDADE_ESTADO_MS = 10 * 60 * 1000;

export class GoogleAgenda {
  constructor(armazem, { fetch: f = (...a) => globalThis.fetch(...a), env = process.env } = {}) {
    this.armazem = armazem;
    this.fetch = f;
    this.clientId = env.GOOGLE_CLIENT_ID || "";
    this.clientSecret = env.GOOGLE_CLIENT_SECRET || "";
    this.tokenAcesso = null; // { valor, expira }
  }

  get configurado() {
    return Boolean(this.clientId && this.clientSecret);
  }

  async conectado() {
    return Boolean((await this.armazem.obter("config", "google"))?.refreshToken);
  }

  // ---------- Conexão ----------
  async linkDeConexao(redirectUri) {
    if (!this.configurado) throw new Error("Google Agenda não configurado: faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.");
    const estado = crypto.randomBytes(16).toString("hex");
    await this.armazem.salvar("google-estados", estado, { criadoEm: Date.now(), redirectUri });
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: ESCOPO,
      access_type: "offline",
      prompt: "consent", // garante o refresh token
      state: estado,
    });
    return `${AUTORIZAR}?${params}`;
  }

  async concluirConexao(code, estado) {
    const salvo = estado && /^[a-f0-9]{32}$/.test(estado) ? await this.armazem.obter("google-estados", estado) : null;
    if (!salvo || Date.now() - salvo.criadoEm > VALIDADE_ESTADO_MS) throw new Error("Link de conexão inválido ou expirado. Tente de novo.");
    await this.armazem.apagar("google-estados", estado);
    const dados = await this.#token({ grant_type: "authorization_code", code, redirect_uri: salvo.redirectUri });
    if (!dados.refresh_token) throw new Error("O Google não devolveu a permissão permanente. Tente conectar de novo.");
    await this.armazem.salvar("config", "google", { refreshToken: dados.refresh_token, conectadoEm: new Date().toISOString() });
    this.#guardarAcesso(dados);
  }

  async desconectar() {
    this.tokenAcesso = null;
    await this.armazem.apagar("config", "google");
  }

  async #token(campos) {
    const resp = await this.fetch(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...campos }),
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (dados.error === "invalid_grant") {
        await this.armazem.apagar("config", "google");
        throw new Error("A conexão com o Google Agenda expirou. Conecte de novo pelo botão na tela.");
      }
      throw new Error(`Google recusou o acesso (${dados.error || resp.status}).`);
    }
    return dados;
  }

  #guardarAcesso(dados) {
    this.tokenAcesso = { valor: dados.access_token, expira: Date.now() + (dados.expires_in - 60) * 1000 };
  }

  async #acesso() {
    if (this.tokenAcesso && Date.now() < this.tokenAcesso.expira) return this.tokenAcesso.valor;
    if (!this.configurado) throw new Error("Google Agenda não configurado.");
    const conf = await this.armazem.obter("config", "google");
    if (!conf?.refreshToken) throw new Error("Google Agenda não conectado. Toque em \"Conectar Google Agenda\" na tela do Jarvis.");
    this.#guardarAcesso(await this.#token({ grant_type: "refresh_token", refresh_token: conf.refreshToken }));
    return this.tokenAcesso.valor;
  }

  async #api(url, opcoes = {}) {
    const resp = await this.fetch(url, {
      ...opcoes,
      headers: { authorization: `Bearer ${await this.#acesso()}`, "content-type": "application/json", ...(opcoes.headers || {}) },
    });
    if (resp.status === 204) return null;
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`Erro do Google Agenda: ${dados.error?.message || resp.status}`);
    return dados;
  }

  // ---------- Eventos ----------
  async listarEventos(inicio, fim) {
    const params = new URLSearchParams({
      timeMin: new Date(inicio).toISOString(),
      timeMax: new Date(fim).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "50",
    });
    const dados = await this.#api(`${EVENTOS}?${params}`);
    return (dados.items || []).map((e) => ({
      id: e.id,
      titulo: e.summary || "(sem título)",
      inicio: e.start?.dateTime || e.start?.date,
      fim: e.end?.dateTime || e.end?.date,
      diaInteiro: Boolean(e.start?.date),
      local: e.location || "",
      descricao: e.description || "",
    }));
  }

  async criarEvento({ titulo, inicio, fim, local, descricao }) {
    for (const [nome, v] of [["inicio", inicio], ["fim", fim]]) {
      if (Number.isNaN(lerData(v).getTime())) throw new Error(`Data inválida em ${nome}: ${v}`);
    }
    if (lerData(fim) <= lerData(inicio)) throw new Error("O fim do evento precisa ser depois do início.");
    const tz = fuso();
    const e = await this.#api(EVENTOS, {
      method: "POST",
      body: JSON.stringify({
        summary: titulo,
        location: local || undefined,
        description: descricao || undefined,
        start: { dateTime: lerData(inicio).toISOString(), timeZone: tz },
        end: { dateTime: lerData(fim).toISOString(), timeZone: tz },
      }),
    });
    return { id: e.id, titulo: e.summary, inicio: e.start?.dateTime, fim: e.end?.dateTime, link: e.htmlLink };
  }

  async apagarEvento(id) {
    await this.#api(`${EVENTOS}/${encodeURIComponent(id)}`, { method: "DELETE" });
    return { apagado: true };
  }
}
