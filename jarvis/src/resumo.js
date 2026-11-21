// Resumo diário no WhatsApp: agenda do dia, lembretes de hoje e finanças do mês.
// Montado sem a IA (não gasta crédito da Anthropic). Sai uma vez por dia, na hora de
// JARVIS_RESUMO_HORA (padrão 7). Para desligar: JARVIS_RESUMO_HORA=desligado.
import { hojeLocal } from "./db.js";

const JANELA_HORAS = 4; // se o horário passar (servidor parado), ainda manda até 4h depois
const MAX_TENTATIVAS = 3; // se o WhatsApp recusar, tenta de novo nos minutos seguintes, até 3 vezes

export function horaDoResumo(env = process.env) {
  const valor = (env.JARVIS_RESUMO_HORA ?? "7").trim().toLowerCase();
  if (["", "desligado", "nao", "não", "off"].includes(valor)) return null;
  const hora = Number.parseInt(valor, 10);
  return Number.isInteger(hora) && hora >= 0 && hora <= 23 ? hora : 7;
}

const real = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const horaMin = (d) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// Monta o texto do resumo (usa o fuso do processo, definido por definirFuso).
export async function montarResumo(banco, agenda, agora = new Date()) {
  const nome = process.env.JARVIS_NOME_USUARIO;
  const dia = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  const partes = [`☀️ Bom dia${nome ? `, ${nome}` : ""}! Resumo de ${dia}:`];

  // Agenda do Google
  if (agenda?.configurado) {
    if (!(await agenda.conectado())) {
      partes.push("📅 Agenda: o Google Agenda está desconectado. Abra o Jarvis e toque em \"Conectar Google Agenda\".");
    } else {
      try {
        const inicio = new Date(agora);
        inicio.setHours(0, 0, 0, 0);
        const fim = new Date(inicio);
        fim.setDate(fim.getDate() + 1);
        const eventos = await agenda.listarEventos(inicio, fim);
        partes.push(
          eventos.length
            ? `📅 Agenda:\n${eventos.map((e) => `• ${e.diaInteiro ? "Dia todo" : horaMin(e.inicio)} – ${e.titulo}`).join("\n")}`
            : "📅 Agenda: nada marcado hoje.",
        );
      } catch (erro) {
        console.error("Resumo diário, agenda:", erro.message);
        partes.push("📅 Agenda: não consegui ler o Google Agenda agora.");
      }
    }
  }

  // Lembretes de hoje (que ainda não foram concluídos)
  const hoje = hojeLocal(agora);
  const lembretes = (await banco.listarLembretes()).filter((l) => hojeLocal(new Date(l.quando)) === hoje);
  partes.push(
    lembretes.length
      ? `⏰ Lembretes de hoje:\n${lembretes.map((l) => `• ${horaMin(l.quando)} – ${l.texto}`).join("\n")}`
      : "⏰ Lembretes: nenhum para hoje.",
  );

  // Finanças do mês
  const r = await banco.resumoFinanceiro(hoje.slice(0, 7));
  const maiores = Object.entries(r.gastosPorCategoria)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c, v]) => `${c} ${real(v)}`);
  partes.push(
    `💰 Finanças do mês: entradas ${real(r.entradas)}, saídas ${real(r.saidas)}, saldo ${real(r.saldo)}.` +
      (maiores.length ? `\nMaiores gastos: ${maiores.join(", ")}.` : ""),
  );

  partes.push("Tenha um ótimo dia! 🚀");
  return partes.join("\n\n");
}

// Chamada a cada minuto: manda o resumo quando chega a hora, uma vez só por dia.
export async function enviarResumoDiario(banco, armazem, whatsapp, agenda, agora = new Date(), hora = horaDoResumo()) {
  if (!whatsapp.configurado || hora === null) return { enviado: false };
  const h = agora.getHours();
  if (h < hora || h >= hora + JANELA_HORAS) return { enviado: false };

  const hoje = hojeLocal(agora);
  const registro = (await armazem.obter("resumo-diario", hoje)) || { tentativas: 0 };
  if (registro.enviado || registro.tentativas >= MAX_TENTATIVAS) return { enviado: false };

  try {
    await whatsapp.enviar(await montarResumo(banco, agenda, agora));
    await armazem.salvar("resumo-diario", hoje, { enviado: true, em: agora.toISOString() });
    return { enviado: true };
  } catch (erro) {
    console.error("Resumo diário:", erro.message);
    await armazem.salvar("resumo-diario", hoje, { tentativas: registro.tentativas + 1 });
    return { enviado: false };
  }
}
