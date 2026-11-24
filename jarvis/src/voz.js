// Banco de vozes: a fala do Jarvis gerada pelo Google Cloud Text-to-Speech (vozes naturais,
// iguais em todos os aparelhos). Precisa de GOOGLE_TTS_KEY (chave de API do Google Cloud com a
// "Cloud Text-to-Speech API" ativada). Sem a chave, o Jarvis continua com a voz do navegador.
const API = "https://texttospeech.googleapis.com/v1";
const IDIOMAS = ["pt-BR", "en-US", "en-GB"];
const VALIDADE_LISTA_MS = 24 * 60 * 60 * 1000;
const MAX_CARACTERES = 1500;

// Ordem do banco: as mais naturais primeiro.
const FAMILIAS = ["Chirp3-HD", "Chirp-HD", "Studio", "Neural2", "Wavenet", "Polyglot", "News", "Standard"];
const familia = (nome) => FAMILIAS.find((f) => nome.includes(`-${f}-`)) || "Outra";

export class Voz {
  constructor({ fetch: f = (...a) => globalThis.fetch(...a), env = process.env } = {}) {
    this.fetch = f;
    this.chave = (env.GOOGLE_TTS_KEY || "").trim();
    this.lista = null;
  }

  get configurado() {
    return Boolean(this.chave);
  }

  async #chamar(caminho, corpo) {
    const resp = await this.fetch(`${API}/${caminho}${caminho.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.chave)}`, corpo
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }
      : undefined);
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = dados.error?.message || `erro ${resp.status}`;
      if (resp.status === 403) throw new Error(`O Google recusou a chave de voz (ative a "Cloud Text-to-Speech API" no projeto e confira a chave). ${msg}`);
      throw new Error(`O Google Text-to-Speech recusou: ${msg}`);
    }
    return dados;
  }

  // Vozes em português e inglês, das mais naturais para as mais simples (guardadas por 1 dia).
  async vozes() {
    if (!this.configurado) return [];
    if (this.lista && Date.now() - this.lista.em < VALIDADE_LISTA_MS) return this.lista.vozes;
    const { voices = [] } = await this.#chamar("voices");
    const vozes = voices
      .flatMap((v) => (v.languageCodes || []).filter((l) => IDIOMAS.includes(l)).map((idioma) => ({
        nome: v.name, idioma, genero: v.ssmlGender === "MALE" ? "masculina" : v.ssmlGender === "FEMALE" ? "feminina" : "neutra", familia: familia(v.name),
      })))
      .filter((v) => v.nome.startsWith(v.idioma))
      .sort((a, b) => a.idioma.localeCompare(b.idioma) || FAMILIAS.indexOf(a.familia) - FAMILIAS.indexOf(b.familia) || a.nome.localeCompare(b.nome));
    this.lista = { em: Date.now(), vozes };
    return vozes;
  }

  // Gera o áudio (MP3) de um trecho de texto.
  async falar({ texto, voz, velocidade = 1 }) {
    if (!this.configurado) throw new Error("Banco de vozes não configurado: falta GOOGLE_TTS_KEY.");
    texto = String(texto ?? "").trim().slice(0, MAX_CARACTERES);
    if (!texto) throw new Error("Nada para falar.");
    if (!/^[a-z]{2}-[A-Z]{2}-[\w-]+$/.test(String(voz))) throw new Error("Voz inválida.");
    const idioma = voz.slice(0, 5);
    const audioConfig = { audioEncoding: "MP3" };
    const rate = Number(velocidade);
    if (Number.isFinite(rate) && rate !== 1) audioConfig.speakingRate = Math.min(2, Math.max(0.5, rate));
    const dados = await this.#chamar("text:synthesize", { input: { text: texto }, voice: { languageCode: idioma, name: voz }, audioConfig });
    if (!dados.audioContent) throw new Error("O Google não devolveu o áudio.");
    return Buffer.from(dados.audioContent, "base64");
  }
}
