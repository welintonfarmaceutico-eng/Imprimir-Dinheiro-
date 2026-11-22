// Resumo diário no WhatsApp: previsão do tempo, agenda do dia, lembretes de hoje e finanças do mês.
// No dia 1º, também o relatório do mês que passou.
// Montado sem a IA (não gasta crédito da Anthropic). Sai uma vez por dia, na hora de
// JARVIS_RESUMO_HORA (padrão 7). Para desligar: JARVIS_RESUMO_HORA=desligado.
import { formatar, hojeLocal, horaLocal, inicioDoDia, instanteLocal } from "./fuso.js";
import { textoPrevisao } from "./clima.js";

const JANELA_HORAS = 4; // se o horário passar (servidor parado), ainda manda até 4h depois
const MAX_TENTATIVAS = 3; // se o WhatsApp recusar, tenta de novo nos minutos seguintes, até 3 vezes

export function horaDoResumo(env = process.env) {
  const valor = (env.JARVIS_RESUMO_HORA ?? "7").trim().toLowerCase();
  if (["", "desligado", "nao", "não", "off"].includes(valor)) return null;
  const hora = Number.parseInt(valor, 10);
  return Number.isInteger(hora) && hora >= 0 && hora <= 23 ? hora : 7;
}

const real = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const horaMin = (d) => formatar(d, { hour: "2-digit", minute: "2-digit" });

// Monta o texto do resumo, no fuso do usuário.
export async function montarResumo(banco, agenda, agora = new Date(), toledo = null, clima = null) {
  const nome = process.env.JARVIS_NOME_USUARIO;
  const dia = formatar(agora, { weekday: "long", day: "2-digit", month: "2-digit" });
  const partes = [`☀️ Bom dia${nome ? `, ${nome}` : ""}! Resumo de ${dia}:`];

  // Previsão do tempo (só se a cidade já foi informada)
  if (clima) {
    try {
      const previsao = textoPrevisao(await clima.previsaoDeHoje(agora));
      partes.push(previsao || '🌤️ Para ver a previsão do tempo aqui, diga ao Jarvis: "minha cidade é ..."');
    } catch (erro) {
      console.error("Resumo diário, previsão:", erro.message);
    }
  }

  // Agenda do Google
  if (agenda?.configurado) {
    if (!(await agenda.conectado())) {
      partes.push("📅 Agenda: o Google Agenda está desconectado. Abra o Jarvis e toque em \"Conectar Google Agenda\".");
    } else {
      try {
        const eventos = await agenda.listarEventos(inicioDoDia(agora), inicioDoDia(agora, 1));
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

  // Carteira da Porto e Toledo (se estiver ligada). Falha aqui não derruba o resto do resumo.
  if (toledo?.configurado) {
    try {
      partes.push(await toledo.textoResumo());
    } catch (erro) {
      console.error("Resumo diário, Toledo:", erro.message);
      partes.push("🏢 Carteira Toledo: não consegui consultar o sistema agora.");
    }
  }

  partes.push("Tenha um ótimo dia! 🚀");
  return partes.join("\n\n");
}

// Chamada a cada minuto: manda o resumo quando chega a hora, uma vez só por dia.
export async function enviarResumoDiario(banco, armazem, whatsapp, agenda, agora = new Date(), hora = horaDoResumo(), toledo = null, clima = null) {
  if (!whatsapp.configurado || hora === null) return { enviado: false };
  const h = horaLocal(agora);
  if (h < hora || h >= hora + JANELA_HORAS) return { enviado: false };

  const hoje = hojeLocal(agora);
  const registro = (await armazem.obter("resumo-diario", hoje)) || { tentativas: 0 };
  if (registro.enviado || registro.tentativas >= MAX_TENTATIVAS) return { enviado: false };

  try {
    await whatsapp.enviar(await montarResumo(banco, agenda, agora, toledo, clima));
    await armazem.salvar("resumo-diario", hoje, { enviado: true, em: agora.toISOString() });
    return { enviado: true };
  } catch (erro) {
    console.error("Resumo diário:", erro.message);
    await armazem.salvar("resumo-diario", hoje, { tentativas: registro.tentativas + 1 });
    return { enviado: false };
  }
}

// ---------- Relatório do mês (dia 1º, na hora do resumo) ----------
const mesAnterior = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};
const nomeDoMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return formatar(instanteLocal(a, m, 15, 12), { month: "long" });
};

export async function montarRelatorioMensal(banco, mes) {
  const r = await banco.resumoFinanceiro(mes);
  const nome = nomeDoMes(mes);
  if (!r.quantidade) return `📊 Relatório de ${nome}: nenhuma entrada ou gasto foi registrado no mês.`;
  const linhas = [`📊 Relatório de ${nome}:`, `Entradas: ${real(r.entradas)}`, `Saídas: ${real(r.saidas)}`, `Saldo: ${real(r.saldo)} ${r.saldo >= 0 ? "✅" : "⚠️"}`];
  const maiores = Object.entries(r.gastosPorCategoria).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (maiores.length) linhas.push("", "Maiores gastos:", ...maiores.map(([c, v]) => `• ${c}: ${real(v)}`));
  const antes = await banco.resumoFinanceiro(mesAnterior(mes));
  if (antes.saidas > 0 && r.saidas > 0) {
    const dif = Math.round(((r.saidas - antes.saidas) / antes.saidas) * 100);
    const comparacao = dif === 0 ? "o mesmo que" : dif > 0 ? `${dif}% a mais que` : `${-dif}% a menos que`;
    linhas.push("", `Você gastou ${comparacao} em ${nomeDoMes(mesAnterior(mes))}.`);
  }
  return linhas.join("\n");
}

export async function enviarRelatorioMensal(banco, armazem, whatsapp, agora = new Date(), hora = horaDoResumo()) {
  if (!whatsapp.configurado || hora === null) return { enviado: false };
  const hoje = hojeLocal(agora);
  const h = horaLocal(agora);
  if (!hoje.endsWith("-01") || h < hora || h >= hora + JANELA_HORAS) return { enviado: false };

  const mes = mesAnterior(hoje.slice(0, 7));
  const registro = (await armazem.obter("relatorio-mensal", mes)) || { tentativas: 0 };
  if (registro.enviado || registro.tentativas >= MAX_TENTATIVAS) return { enviado: false };
  try {
    await whatsapp.enviar(await montarRelatorioMensal(banco, mes));
    await armazem.salvar("relatorio-mensal", mes, { enviado: true, em: agora.toISOString() });
    return { enviado: true };
  } catch (erro) {
    console.error("Relatório mensal:", erro.message);
    await armazem.salvar("relatorio-mensal", mes, { tentativas: registro.tentativas + 1 });
    return { enviado: false };
  }
}
