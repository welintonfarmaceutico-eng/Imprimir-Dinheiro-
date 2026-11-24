// Monta o link seguro para abrir um app ou site no aparelho do usuário (no celular Android,
// esses endereços abrem o próprio app: YouTube, Spotify, Waze, Maps, WhatsApp, telefone).
// Só gera endereços http(s) conhecidos, "tel:" e "sms:" — nunca um esquema qualquer vindo da IA.

export const APPS = ["youtube", "spotify", "waze", "google_maps", "whatsapp", "ligar", "sms", "instagram", "netflix", "uber", "ifood", "gmail", "google_agenda", "mercado_livre", "site", "pesquisa"];

const enc = encodeURIComponent;
const digitos = (s) => String(s ?? "").replace(/\D/g, "");

// Número do Brasil sem o 55 na frente ganha o código do país (o WhatsApp exige).
function numeroWhatsApp(numero) {
  const d = digitos(numero);
  if (!d) return "";
  return d.length <= 11 ? `55${d}` : d;
}

function endereco(site) {
  const s = String(site ?? "").trim();
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(s)) return `https://${s}`; // "g1.com.br"
  return null;
}

export function montarLink({ app, busca = "", numero = "", mensagem = "", nome = "" }) {
  busca = String(busca ?? "").trim().slice(0, 300);
  mensagem = String(mensagem ?? "").trim().slice(0, 1000);
  nome = String(nome ?? "").trim().slice(0, 60);

  switch (app) {
    case "youtube":
      return { rotulo: busca ? `Ver "${busca}" no YouTube` : "Abrir o YouTube", url: busca ? `https://www.youtube.com/results?search_query=${enc(busca)}` : "https://www.youtube.com/" };
    case "spotify":
      return { rotulo: busca ? `Tocar "${busca}" no Spotify` : "Abrir o Spotify", url: busca ? `https://open.spotify.com/search/${enc(busca)}` : "https://open.spotify.com/" };
    case "waze":
      return { rotulo: busca ? `Ir para ${busca} no Waze` : "Abrir o Waze", url: busca ? `https://waze.com/ul?q=${enc(busca)}&navigate=yes` : "https://waze.com/ul" };
    case "google_maps":
      return { rotulo: busca ? `Rota para ${busca} no Maps` : "Abrir o Google Maps", url: busca ? `https://www.google.com/maps/dir/?api=1&destination=${enc(busca)}` : "https://www.google.com/maps" };
    case "whatsapp": {
      const n = numeroWhatsApp(numero);
      const texto = mensagem ? `?text=${enc(mensagem)}` : "";
      const para = nome || (n ? `+${n}` : "");
      return { rotulo: para ? `Abrir WhatsApp com ${para}` : "Escolher contato no WhatsApp", url: `https://wa.me/${n}${texto}` };
    }
    case "ligar": {
      const d = digitos(numero);
      if (d.length < 3) throw new Error("Preciso do número de telefone para ligar.");
      const tel = String(numero).trim().startsWith("+") ? `+${d}` : d;
      return { rotulo: `Ligar para ${nome || numero}`, url: `tel:${tel}` };
    }
    case "instagram": {
      const perfil = busca.replace(/^@/, "");
      return /^[a-z0-9._]{1,30}$/i.test(perfil)
        ? { rotulo: `Abrir @${perfil} no Instagram`, url: `https://www.instagram.com/${perfil}/` }
        : { rotulo: "Abrir o Instagram", url: "https://www.instagram.com/" };
    }
    case "netflix":
      return { rotulo: busca ? `Procurar "${busca}" na Netflix` : "Abrir a Netflix", url: busca ? `https://www.netflix.com/search?q=${enc(busca)}` : "https://www.netflix.com/" };
    case "site": {
      const url = endereco(busca);
      if (url) return { rotulo: `Abrir ${new URL(url).hostname.replace(/^www\./, "")}`, url };
      return { rotulo: `Pesquisar "${busca}"`, url: `https://www.google.com/search?q=${enc(busca)}` };
    }
    case "pesquisa":
      return { rotulo: `Pesquisar "${busca}" no Google`, url: `https://www.google.com/search?q=${enc(busca)}` };
    case "sms": {
      const d = digitos(numero);
      if (d.length < 3) throw new Error("Preciso do número de telefone para mandar SMS.");
      const tel = String(numero).trim().startsWith("+") ? `+${d}` : d;
      return { rotulo: `SMS para ${nome || numero}`, url: `sms:${tel}${mensagem ? `?body=${enc(mensagem)}` : ""}` };
    }
    case "uber":
      return { rotulo: busca ? `Uber até ${busca}` : "Abrir o Uber", url: busca ? `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${enc(busca)}` : "https://m.uber.com/ul/" };
    case "ifood":
      return { rotulo: busca ? `Procurar "${busca}" no iFood` : "Abrir o iFood", url: busca ? `https://www.ifood.com.br/busca?q=${enc(busca)}` : "https://www.ifood.com.br/" };
    case "gmail": {
      // Com destinatário ou assunto: abre um e-mail novo já preenchido.
      const para = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(numero).trim()) ? String(numero).trim() : "";
      if (para || mensagem) return { rotulo: `Escrever e-mail${para ? ` para ${para}` : ""}`, url: `https://mail.google.com/mail/?view=cm&fs=1${para ? `&to=${enc(para)}` : ""}${busca ? `&su=${enc(busca)}` : ""}${mensagem ? `&body=${enc(mensagem)}` : ""}` };
      return { rotulo: "Abrir o Gmail", url: "https://mail.google.com/" };
    }
    case "google_agenda":
      return { rotulo: "Abrir o Google Agenda", url: "https://calendar.google.com/" };
    case "mercado_livre":
      return { rotulo: busca ? `Procurar "${busca}" no Mercado Livre` : "Abrir o Mercado Livre", url: busca ? `https://lista.mercadolivre.com.br/${enc(busca.replace(/\s+/g, "-"))}` : "https://www.mercadolivre.com.br/" };
    default:
      throw new Error(`App não suportado: ${app}`);
  }
}
