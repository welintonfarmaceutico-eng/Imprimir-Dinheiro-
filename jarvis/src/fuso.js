// Datas e horas no fuso do usuário (JARVIS_FUSO, padrão America/Sao_Paulo), sem depender do
// relógio do servidor: no Cloudflare o servidor está sempre em UTC e a variável TZ não vale.

export const fuso = () => process.env.JARVIS_FUSO || "America/Sao_Paulo";

const formatos = new Map();
export function partes(d, tz = fuso()) {
  let f = formatos.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatos.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(d)) o[p.type] = Number(p.value);
  return { ano: o.year, mes: o.month, dia: o.day, hora: o.hour, minuto: o.minute, segundo: o.second };
}

// Diferença do fuso para o UTC, em minutos (ex.: -180 para Brasília).
function deslocamento(d) {
  const p = partes(d);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return Math.round((comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

// Um horário "de relógio" no fuso do usuário vira o instante certo. Aceita dia/mês fora do limite (ex.: dia 32).
export function instanteLocal(ano, mes, dia, hora = 0, minuto = 0, segundo = 0) {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo);
  const off = deslocamento(new Date(palpite));
  let t = palpite - off * 60000;
  const off2 = deslocamento(new Date(t)); // ajuste perto de mudança de horário de verão
  if (off2 !== off) t = palpite - off2 * 60000;
  return new Date(t);
}

export function hojeLocal(d = new Date()) {
  const p = partes(d);
  const z = (n) => String(n).padStart(2, "0");
  return `${p.ano}-${z(p.mes)}-${z(p.dia)}`;
}

export const horaLocal = (d = new Date()) => partes(d).hora;

// Meia-noite de hoje (ou de daqui a N dias) no fuso do usuário.
export function inicioDoDia(d = new Date(), somarDias = 0) {
  const p = partes(d);
  return instanteLocal(p.ano, p.mes, p.dia + somarDias);
}

// Data/hora local em ISO 8601 com o fuso, ex.: 2026-11-21T15:30:00-03:00
export function isoLocal(d = new Date()) {
  const p = partes(d);
  const z = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const off = deslocamento(d);
  return `${p.ano}-${z(p.mes)}-${z(p.dia)}T${z(p.hora)}:${z(p.minuto)}:00${off >= 0 ? "+" : "-"}${z(off / 60)}:${z(off % 60)}`;
}

// Lê uma data. Sem fuso no texto (ex.: "2026-11-21T17:00"), entende como horário do usuário.
export function lerData(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(String(valor).trim());
  if (m) return instanteLocal(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return new Date(valor);
}

// Formatação em português, sempre no fuso do usuário.
export const formatar = (d, opcoes) => new Date(d).toLocaleString("pt-BR", { timeZone: fuso(), ...opcoes });

// ---------- Lembretes que se repetem ----------
export const REPETICOES = ["diario", "dias_uteis", "semanal", "mensal"];
const diasNoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const diaDaSemana = (ano, mes, dia) => new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay(); // 0 = domingo

// Próxima vez (depois de "agora") de um lembrete que se repete, no mesmo horário local.
export function proximaRepeticao(quando, repetir, agora = new Date()) {
  const base = partes(new Date(quando));
  let { ano, mes, dia } = base;
  const diaOriginal = base.dia;
  for (let i = 0; i < 1000; i++) {
    if (repetir === "mensal") {
      mes += 1;
      if (mes > 12) { mes = 1; ano += 1; }
      dia = Math.min(diaOriginal, diasNoMes(ano, mes)); // dia 31 vira o último dia do mês
    } else {
      const passo = repetir === "semanal" ? 7 : 1;
      const d = new Date(Date.UTC(ano, mes - 1, dia + passo));
      ano = d.getUTCFullYear(); mes = d.getUTCMonth() + 1; dia = d.getUTCDate();
      if (repetir === "dias_uteis" && [0, 6].includes(diaDaSemana(ano, mes, dia))) continue;
    }
    const proxima = instanteLocal(ano, mes, dia, base.hora, base.minuto);
    if (proxima > agora) return proxima;
  }
  throw new Error("Não consegui calcular a próxima repetição.");
}
