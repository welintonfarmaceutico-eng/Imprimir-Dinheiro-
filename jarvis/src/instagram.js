// Instagram da Porto e Toledo: avisa no WhatsApp/Telegram quando chega comentário ou mensagem (direct).
// Usa a API oficial do Instagram (conta Profissional), só para LEITURA. Precisa de INSTAGRAM_TOKEN
// (token de longa duração gerado no painel da Meta). O token é renovado sozinho a cada 7 dias.
const API = "https://graph.instagram.com/v21.0";
const RENOVAR = "https://graph.instagram.com/refresh_access_token";
const INTERVALO_MS = 5 * 60 * 1000; // confere a cada 5 minutos
const RENOVAR_MS = 7 * 24 * 60 * 60 * 1000;
const POSTS_RECENTES = 10;

const curto = (t, n = 140) => {
  t = String(t ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export class Instagram {
  constructor(armazem, { fetch: f = (...a) => globalThis.fetch(...a), env = process.env } = {}) {
    this.armazem = armazem;
    this.fetch = f;
    this.tokenInicial = (env.INSTAGRAM_TOKEN || "").trim();
  }

  get configurado() {
    return Boolean(this.tokenInicial);
  }

  // O token renovado fica no banco; se o token do Cloudflare for trocado, ele passa a valer.
  async #token() {
    const salvo = await this.armazem.obter("config", "instagram");
    if (salvo?.token && salvo.inicial === this.tokenInicial) return salvo;
    const novo = { token: this.tokenInicial, inicial: this.tokenInicial, renovadoEm: this.agora ?? Date.now() };
    await this.armazem.salvar("config", "instagram", novo);
    return novo;
  }

  async #get(caminho, params = {}) {
    const { token } = await this.#token();
    const url = caminho.startsWith("http") ? caminho : `${API}/${caminho}`;
    const resp = await this.fetch(`${url}?${new URLSearchParams({ ...params, access_token: token })}`);
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok || dados.error) {
      const msg = dados.error?.message || `erro ${resp.status}`;
      if (dados.error?.code === 190) throw new Error(`O token do Instagram venceu ou é inválido. Gere outro no painel da Meta e troque o INSTAGRAM_TOKEN. (${msg})`);
      throw new Error(`O Instagram recusou: ${msg}`);
    }
    return dados;
  }

  async #renovarSePreciso(agora) {
    const conf = await this.#token();
    if (agora - (conf.renovadoEm || 0) < RENOVAR_MS) return;
    try {
      const r = await this.#get(RENOVAR, { grant_type: "ig_refresh_token" });
      if (r.access_token) await this.armazem.salvar("config", "instagram", { ...conf, token: r.access_token, renovadoEm: agora });
    } catch (erro) {
      console.error("Instagram, renovar token:", erro.message);
    }
  }

  async conta() {
    return this.#get("me", { fields: "user_id,username" });
  }

  // Busca comentários e mensagens que ainda não foram avisados.
  async #buscarNovidades(eu) {
    const novidades = [];
    const posts = await this.#get("me/media", { fields: "id,caption,comments_count", limit: String(POSTS_RECENTES) });
    for (const post of posts.data || []) {
      if (!post.comments_count) continue;
      const comentarios = await this.#get(`${post.id}/comments`, { fields: "id,text,username,timestamp", limit: "25" });
      for (const c of comentarios.data || []) {
        if (c.username === eu.username) continue; // respostas da própria conta
        novidades.push({ id: `c-${c.id}`, tipo: "comentario", de: c.username, texto: curto(c.text), post: curto(post.caption, 40), quando: c.timestamp });
      }
    }
    // Mensagens do direct (pode não estar liberado: aí só os comentários funcionam).
    try {
      const conversas = await this.#get("me/conversations", { platform: "instagram", fields: "messages.limit(3){id,message,from,created_time}", limit: "10" });
      for (const conversa of conversas.data || []) {
        for (const m of conversa.messages?.data || []) {
          const de = m.from?.username;
          if (!de || de === eu.username || m.from?.id === eu.user_id) continue;
          novidades.push({ id: `m-${m.id}`, tipo: "mensagem", de, texto: curto(m.message || "(foto, áudio ou figurinha)"), quando: m.created_time });
        }
      }
    } catch (erro) {
      console.error("Instagram, mensagens:", erro.message);
    }
    return novidades;
  }

  // Chamado pelo relógio de minuto em minuto: confere a cada 5 minutos e avisa nos canais.
  // Na primeira vez, só marca o que já existe como visto (para não chegar uma enxurrada de avisos antigos).
  async verificar(canais, agora = Date.now()) {
    if (!this.configurado) return { avisos: 0 };
    this.agora = agora; // horário desta conferência (o token novo conta a partir dele)
    const controle = (await this.armazem.obter("config", "instagram-controle")) || {};
    if (controle.ultima && agora - controle.ultima < INTERVALO_MS) return { avisos: 0 };
    await this.armazem.salvar("config", "instagram-controle", { ...controle, ultima: agora });

    await this.#renovarSePreciso(agora);
    const eu = await this.conta();
    const novidades = await this.#buscarNovidades(eu);
    const primeiraVez = !controle.iniciado;
    let avisos = 0;
    for (const n of novidades) {
      if (await this.armazem.obter("instagram-vistos", n.id)) continue;
      await this.armazem.salvar("instagram-vistos", n.id, { em: agora });
      if (primeiraVez) continue;
      await this.armazem.salvar("instagram-novidades", n.id, { ...n, avisadoEm: agora });
      const texto = n.tipo === "comentario"
        ? `📸 Instagram: @${n.de} comentou${n.post ? ` em "${n.post}"` : ""}: "${n.texto}"`
        : `💬 Instagram: mensagem de @${n.de}: "${n.texto}"`;
      for (const canal of canais) {
        if (canal?.configurado) await canal.enviar(texto).catch((e) => console.error("Instagram, aviso:", e.message));
      }
      avisos++;
    }
    if (primeiraVez) await this.armazem.salvar("config", "instagram-controle", { ultima: agora, iniciado: true });
    return { avisos };
  }

  // Comentários e mensagens das últimas horas (para o resumo das 7h e para o Jarvis responder).
  async recentes(horas = 24, agora = Date.now()) {
    const todas = await this.armazem.listar("instagram-novidades");
    return todas.filter((n) => agora - n.avisadoEm <= horas * 3600 * 1000).sort((a, b) => b.avisadoEm - a.avisadoEm);
  }

  async textoResumo(agora = Date.now()) {
    const r = await this.recentes(24, agora);
    if (!r.length) return "📸 Instagram: nenhum comentário ou mensagem nova desde ontem.";
    const comentarios = r.filter((n) => n.tipo === "comentario").length;
    const mensagens = r.length - comentarios;
    const partes = [comentarios && `${comentarios} comentário${comentarios > 1 ? "s" : ""}`, mensagens && `${mensagens} mensage${mensagens > 1 ? "ns" : "m"}`].filter(Boolean);
    return [`📸 Instagram desde ontem: ${partes.join(" e ")}.`, ...r.slice(0, 3).map((n) => `• @${n.de}: "${curto(n.texto, 60)}"`)].join("\n");
  }
}
