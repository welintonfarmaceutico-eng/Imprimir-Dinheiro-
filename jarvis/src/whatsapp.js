// Envio de mensagens para o WhatsApp do próprio usuário, pelo serviço CallMeBot.
// Precisa de WHATSAPP_TELEFONE (com DDI, ex.: +5531999998888) e WHATSAPP_APIKEY (veja o README).

const API = "https://api.callmebot.com/whatsapp.php";
const JANELA_MS = 30 * 60 * 1000; // lembretes vencidos há mais de 30 min não são mais enviados

export class WhatsApp {
  constructor({ fetch: f = (...a) => globalThis.fetch(...a), env = process.env } = {}) {
    this.fetch = f;
    this.telefone = (env.WHATSAPP_TELEFONE || "").replace(/[^\d+]/g, "");
    this.apikey = (env.WHATSAPP_APIKEY || "").trim();
  }

  get configurado() {
    return Boolean(this.telefone && this.apikey);
  }

  async enviar(texto) {
    if (!this.configurado) throw new Error("WhatsApp não configurado: faltam WHATSAPP_TELEFONE e WHATSAPP_APIKEY.");
    const params = new URLSearchParams({ phone: this.telefone, text: texto.slice(0, 1500), apikey: this.apikey });
    const resp = await this.fetch(`${API}?${params}`);
    const corpo = await resp.text().catch(() => "");
    // O CallMeBot às vezes responde 200 com a mensagem de erro no texto.
    const sucesso = /queued|sent|enviad/i.test(corpo);
    if (!resp.ok || (!sucesso && /error|invalid|not allowed|apikey/i.test(corpo))) {
      // Guarda a resposta no log (sem a apikey) para descobrir o motivo.
      const texto = corpo.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").split(this.apikey).join("***").slice(0, 400);
      console.error(`CallMeBot recusou (HTTP ${resp.status}): ${texto}`);
      throw new Error(`O WhatsApp recusou a mensagem (${resp.status}).`);
    }
    return { enviado: true };
  }
}

// Envia para o WhatsApp os lembretes que acabaram de vencer. Cada lembrete é enviado uma vez só:
// o envio é marcado numa coleção própria, para não disputar a gravação com os avisos do navegador.
export async function enviarLembretesVencidos(banco, armazem, whatsapp, agora = new Date()) {
  if (!whatsapp.configurado) return { enviados: 0 };
  const lembretes = await banco.listarLembretes();
  let enviados = 0;
  for (const l of lembretes) {
    const quando = new Date(l.quando);
    if (quando > agora || agora - quando > JANELA_MS) continue;
    const chave = `${l.id}-${quando.getTime()}`; // lembrete que se repete: cada vez é um envio
    const colecao = whatsapp.nome === "telegram" ? "telegram-enviados" : "whatsapp-enviados"; // cada canal guarda o seu
    if (await armazem.obter(colecao, chave)) continue;
    try {
      await whatsapp.enviar(`⏰ Lembrete do Jarvis: ${l.texto}`);
      await armazem.salvar(colecao, chave, { em: agora.toISOString() });
      enviados++;
    } catch (erro) {
      console.error(`Lembrete ${l.id}:`, erro.message); // tenta de novo no próximo minuto
    }
  }
  return { enviados };
}
