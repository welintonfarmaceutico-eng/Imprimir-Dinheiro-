// Resumo diário no WhatsApp: previsão do tempo, agenda do dia, lembretes de hoje e finanças do mês.
// No dia 1º, também o relatório do mês que passou.
// Montado sem a IA (não gasta crédito da Anthropic). Sai uma vez por dia, na hora de
// JARVIS_RESUMO_HORA (padrão 7). Ligar, desligar, pular e mudar a hora: pelo Jarvis ou em Ajustes
// (fica guardado no banco e vale mais que a variável).
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

// ---------- Ligar, desligar, pular e mudar a hora do resumo (pelo Jarvis ou pelos Ajustes) ----------
// O que foi escolhido fica no banco e vale mais que a variável JARVIS_RESUMO_HORA.
export async function configDoResumo(armazem, env = process.env) {
  const salvo = (await armazem.obter("config", "resumo")) || {};
  const horaEnv = horaDoResumo(env);
  return {
    ligado: typeof salvo.ligado === "boolean" ? salvo.ligado : horaEnv !== null,
    hora: Number.isInteger(salvo.hora) ? salvo.hora : (horaEnv ?? 7),
    pularDia: salvo.pularDia || "",
  };
}

const dataBR = (iso) => iso.split("-").reverse().slice(0, 2).join("/");

export function descreverResumo(c, agora = new Date()) {
  if (!c.ligado) return "O resumo diário está desligado.";
  const hoje = hojeLocal(agora), amanha = hojeLocal(inicioDoDia(agora, 1));
  const pulo = c.pularDia === hoje ? " O de hoje vai ser pulado." : c.pularDia === amanha ? " O de amanhã vai ser pulado." : c.pularDia > hoje ? ` O do dia ${dataBR(c.pularDia)} vai ser pulado.` : "";
  return `O resumo diário está ligado, todo dia às ${c.hora}h.${pulo}`;
}

export async function alterarResumo(armazem, { acao, hora }, agora = new Date()) {
  const c = await configDoResumo(armazem);
  switch (acao) {
    case "ligar": c.ligado = true; break;
    case "desligar": c.ligado = false; c.pularDia = ""; break;
    case "mudar_hora":
      if (!Number.isInteger(hora) || hora < 0 || hora > 23) throw new Error("A hora precisa ser de 0 a 23.");
      c.hora = hora; c.ligado = true; break;
    case "pular_proximo": {
      // O próximo é o de hoje, se ainda não chegou a hora; senão, o de amanhã.
      const hoje = hojeLocal(agora);
      const jaEnviado = (await armazem.obter("resumo-diario", hoje))?.enviado;
      c.pularDia = !jaEnviado && horaLocal(agora) < c.hora ? hoje : hojeLocal(inicioDoDia(agora, 1));
      c.ligado = true;
      break;
    }
    case "cancelar_pulo": c.pularDia = ""; break;
    case "ver": break;
    default: throw new Error(`Ação desconhecida: ${acao}`);
  }
  if (acao !== "ver") await armazem.salvar("config", "resumo", c);
  return { ...c, descricao: descreverResumo(c, agora) };
}

const real = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const horaMin = (d) => formatar(d, { hour: "2-digit", minute: "2-digit" });

// Monta o texto do resumo, no fuso do usuário.
export async function montarResumo(banco, agenda, agora = new Date(), toledo = null, clima = null, instagram = null) {
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

  // Instagram da Porto e Toledo: comentários e mensagens desde ontem.
  if (instagram?.configurado) {
    try {
      partes.push(await instagram.textoResumo(agora.getTime()));
    } catch (erro) {
      console.error("Resumo diário, Instagram:", erro.message);
    }
  }

  partes.push("Tenha um ótimo dia! 🚀");
  return partes.join("\n\n");
}

// Chamada a cada minuto: manda o resumo quando chega a hora, uma vez só por dia.
export async function enviarResumoDiario(banco, armazem, whatsapp, agenda, agora = new Date(), hora, toledo = null, clima = null, instagram = null) {
  if (!whatsapp.configurado) return { enviado: false };
  const conf = await configDoResumo(armazem);
  if (!conf.ligado) return { enviado: false };
  hora ??= conf.hora;
  const h = horaLocal(agora);
  if (h < hora || h >= hora + JANELA_HORAS) return { enviado: false };

  const hoje = hojeLocal(agora);
  if (conf.pularDia === hoje) return { enviado: false, pulado: true };
  const colecao = whatsapp.nome === "telegram" ? "resumo-diario-telegram" : "resumo-diario"; // cada canal guarda o seu
  const registro = (await armazem.obter(colecao, hoje)) || { tentativas: 0 };
  if (registro.enviado || registro.tentativas >= MAX_TENTATIVAS) return { enviado: false };

  try {
    await whatsapp.enviar(await montarResumo(banco, agenda, agora, toledo, clima, instagram));
    await armazem.salvar(colecao, hoje, { enviado: true, em: agora.toISOString() });
    return { enviado: true };
  } catch (erro) {
    console.error("Resumo diário:", erro.message);
    await armazem.salvar(colecao, hoje, { tentativas: registro.tentativas + 1 });
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

export async function enviarRelatorioMensal(banco, armazem, whatsapp, agora = new Date(), hora) {
  if (!whatsapp.configurado) return { enviado: false };
  const conf = await configDoResumo(armazem);
  if (!conf.ligado) return { enviado: false }; // o relatório do mês sai junto com o resumo
  hora ??= conf.hora;
  const hoje = hojeLocal(agora);
  const h = horaLocal(agora);
  if (!hoje.endsWith("-01") || h < hora || h >= hora + JANELA_HORAS) return { enviado: false };

  const mes = mesAnterior(hoje.slice(0, 7));
  const colecao = whatsapp.nome === "telegram" ? "relatorio-mensal-telegram" : "relatorio-mensal";
  const registro = (await armazem.obter(colecao, mes)) || { tentativas: 0 };
  if (registro.enviado || registro.tentativas >= MAX_TENTATIVAS) return { enviado: false };
  try {
    await whatsapp.enviar(await montarRelatorioMensal(banco, mes));
    await armazem.salvar(colecao, mes, { enviado: true, em: agora.toISOString() });
    return { enviado: true };
  } catch (erro) {
    console.error("Relatório mensal:", erro.message);
    await armazem.salvar(colecao, mes, { tentativas: registro.tentativas + 1 });
    return { enviado: false };
  }
}
