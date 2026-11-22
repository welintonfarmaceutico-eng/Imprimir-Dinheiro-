// Previsão do tempo pelo Open-Meteo (gratuito, sem chave). A cidade fica salva no banco:
// o usuário diz "minha cidade é Montes Claros" e o Jarvis guarda as coordenadas.
import { fuso, hojeLocal } from "./fuso.js";

const GEOCODIFICAR = "https://geocoding-api.open-meteo.com/v1/search";
const PREVISAO = "https://api.open-meteo.com/v1/forecast";

const CONDICOES = [
  [[0], "céu limpo"],
  [[1, 2], "poucas nuvens"],
  [[3], "nublado"],
  [[45, 48], "neblina"],
  [[51, 53, 55, 56, 57], "garoa"],
  [[61, 63, 65, 66, 67], "chuva"],
  [[71, 73, 75, 77, 85, 86], "neve"],
  [[80, 81, 82], "pancadas de chuva"],
  [[95, 96, 99], "trovoadas"],
];
export const condicao = (codigo) => CONDICOES.find(([cs]) => cs.includes(Number(codigo)))?.[1] ?? "tempo variável";

export class Clima {
  constructor(armazem, { fetch: f = (...a) => globalThis.fetch(...a) } = {}) {
    this.armazem = armazem;
    this.fetch = f;
  }

  async #json(url) {
    const resp = await this.fetch(url);
    if (!resp.ok) throw new Error(`O serviço de previsão respondeu ${resp.status}.`);
    return resp.json();
  }

  cidade() {
    return this.armazem.obter("config", "cidade");
  }

  // Procura a cidade (de preferência no Brasil) e guarda nome e coordenadas.
  async definirCidade(nome) {
    nome = String(nome ?? "").trim().slice(0, 100);
    if (!nome) throw new Error("Diga o nome da cidade.");
    const busca = (pais) => this.#json(`${GEOCODIFICAR}?${new URLSearchParams({ name: nome.split(",")[0], count: "5", language: "pt", format: "json", ...(pais ? { countryCode: pais } : {}) })}`);
    let achados = (await busca("BR")).results;
    if (!achados?.length) achados = (await busca("")).results; // cidade fora do Brasil
    if (!achados?.length) throw new Error(`Não encontrei a cidade "${nome}".`);
    // Se a pessoa disse o estado ("Montes Claros, MG"), prefere a cidade daquele estado.
    const estado = nome.split(",")[1]?.trim().toLowerCase();
    const c = (estado && achados.find((a) => a.admin1?.toLowerCase().startsWith(estado) || siglaUF(a.admin1) === estado)) || achados[0];
    const cidade = { nome: c.name, estado: c.admin1 || "", pais: c.country || "", lat: c.latitude, lon: c.longitude };
    await this.armazem.salvar("config", "cidade", cidade);
    return cidade;
  }

  // Previsão de hoje: máxima, mínima, chance de chuva e como fica o céu.
  async previsaoDeHoje(agora = new Date()) {
    const cidade = await this.cidade();
    if (!cidade) return null;
    const dados = await this.#json(`${PREVISAO}?${new URLSearchParams({
      latitude: String(cidade.lat), longitude: String(cidade.lon), timezone: fuso(), forecast_days: "2",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    })}`);
    const d = dados.daily;
    const i = Math.max(0, d?.time?.indexOf(hojeLocal(agora)) ?? 0);
    if (!d?.time?.length) throw new Error("A previsão veio vazia.");
    return {
      cidade: cidade.nome,
      maxima: Math.round(d.temperature_2m_max[i]),
      minima: Math.round(d.temperature_2m_min[i]),
      chuva: d.precipitation_probability_max?.[i] ?? null,
      condicao: condicao(d.weather_code?.[i]),
    };
  }
}

const UFS = {
  acre: "ac", alagoas: "al", amapá: "ap", amazonas: "am", bahia: "ba", ceará: "ce", "distrito federal": "df", "espírito santo": "es",
  goiás: "go", maranhão: "ma", "mato grosso": "mt", "mato grosso do sul": "ms", "minas gerais": "mg", pará: "pa", paraíba: "pb",
  paraná: "pr", pernambuco: "pe", piauí: "pi", "rio de janeiro": "rj", "rio grande do norte": "rn", "rio grande do sul": "rs",
  rondônia: "ro", roraima: "rr", "santa catarina": "sc", "são paulo": "sp", sergipe: "se", tocantins: "to",
};
const siglaUF = (estado) => UFS[String(estado ?? "").toLowerCase()];

export function textoPrevisao(p) {
  if (!p) return null;
  const chuva = p.chuva == null ? "" : `, ${p.chuva}% de chance de chuva`;
  return `🌤️ Tempo em ${p.cidade}: ${p.condicao}, máxima de ${p.maxima}° e mínima de ${p.minima}°${chuva}.`;
}
