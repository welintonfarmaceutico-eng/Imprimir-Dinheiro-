// Ferramentas que o Jarvis pode usar: notas, lembretes e finanças.
// Cada ferramenta tem a definição enviada ao Claude e a função que executa.

import { APPS, montarLink } from "./links.js";
import { alterarResumo } from "./resumo.js";
import { MATERIAS } from "./escola.js";

const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// A API aceita no máximo 20 ferramentas "strict" (validação rígida do que a IA preenche) por pedido.
// Strict fica nas que gravam ou agem (gastos, lembretes, agenda, PC...); as de só consultar, sem
// parâmetros ou de texto livre vão sem strict. A trava garante o limite mesmo com ferramentas novas.
export const MAX_STRICT = 20;
const SEM_STRICT = new Set([
  "listar_notas", "listar_lembretes", "resumo_financeiro", "listar_transacoes", "agenda_listar_eventos",
  "consultar_carteira_toledo", "instagram_novidades", "definir_cidade", "documento_pronto", "post_instagram",
  "meu_progresso", "progresso_escola",
]);
export function comStrict(ferramentas) {
  let usados = 0;
  return ferramentas.map((f) => {
    const strict = !SEM_STRICT.has(f.definicao.name) && usados < MAX_STRICT;
    if (strict) usados++;
    else if (!SEM_STRICT.has(f.definicao.name)) console.warn(`Ferramenta sem strict (limite de ${MAX_STRICT}): ${f.definicao.name}`);
    return { ...f.definicao, strict };
  });
}

// Documento completo com botão de copiar (usado pelo adulto e pelo Modo Escola).
const DOCUMENTO_PRONTO = {
  definicao: {
    name: "documento_pronto",
    description:
      "Mostra na tela um documento completo, pronto para copiar: notificação extrajudicial, contrato, distrato, recibo, termo de acordo, carta de cobrança, procuração simples etc. " +
      "Use quando o usuário pedir para redigir ou preparar um documento. Use [campo] onde faltar dado (ex.: [CPF do locatário]). Texto simples, sem markdown.",
    input_schema: obj({
      titulo: { type: "string", description: "Nome curto do documento, ex.: \"Notificação extrajudicial de atraso de aluguel\"" },
      texto: { type: "string", description: "O documento inteiro, com quebras de linha" },
    }),
  },
  executar: ({ titulo, texto }) => {
    texto = String(texto ?? "").trim().slice(0, 20000);
    if (!texto) throw new Error("O documento ficou vazio.");
    return { documento: { titulo: String(titulo ?? "").trim().slice(0, 120) || "Documento", texto }, aviso: "O documento já está na tela com botão de copiar; não leia em voz alta, só diga que está pronto e o que a pessoa precisa completar." };
  },
};

// Modo Escola: progresso (estrelas), provas e documento pronto (listas de exercícios, resumos).
export function criarFerramentasEstudante(escola = null) {
  const lista = [DOCUMENTO_PRONTO];
  if (escola) {
    lista.push(
      {
        definicao: {
          name: "registrar_estudo",
          description:
            "Registra um exercício ou pergunta de quiz depois de corrigir a resposta da criança. Chame uma vez por item, sem anunciar. " +
            "resultado: acertou (acertou de primeira), errou (precisou de ajuda ou errou) ou praticou (atividade sem certo/errado, como ler ou conversar em inglês). " +
            "A resposta traz as estrelas e, às vezes, conquistas novas: comemore as conquistas com ela.",
          input_schema: obj({
            materia: { type: "string", enum: MATERIAS },
            assunto: { type: "string", description: "Assunto curto, ex.: frações equivalentes, verbo to be, ciclo da água" },
            resultado: { type: "string", enum: ["acertou", "errou", "praticou"] },
            observacao: { type: "string", description: "Uma frase curta para o pai/mãe sobre como ela foi (\"\" se nada a dizer)" },
          }),
        },
        executar: (input) => escola.registrarEstudo(input),
      },
      {
        definicao: {
          name: "meu_progresso",
          description: "Mostra as estrelas, os dias seguidos de estudo e as últimas conquistas da criança. Use quando ela perguntar.",
          input_schema: obj({}),
        },
        executar: () => escola.progresso(),
      },
      {
        definicao: {
          name: "agendar_prova",
          description: "Guarda uma prova ou trabalho que a criança contou que vai ter, para o professor ajudar a revisar nos dias antes. Calcule a data a partir do horário atual.",
          input_schema: obj({
            materia: { type: "string", enum: MATERIAS },
            assunto: { type: "string", description: "O que vai cair, se ela souber (\"\" se não souber)" },
            data: { type: "string", description: "Data da prova no formato AAAA-MM-DD" },
          }),
        },
        executar: (input) => escola.agendarProva(input),
      },
      {
        definicao: {
          name: "remover_prova",
          description: "Tira uma prova da lista (já aconteceu, foi cancelada ou foi marcada errado).",
          input_schema: obj({
            materia: { type: "string", enum: MATERIAS },
            data: { type: "string", description: "Data da prova AAAA-MM-DD (\"\" para todas dessa matéria)" },
          }),
        },
        executar: ({ materia, data }) => escola.removerProva({ materia, data: data || undefined }),
      },
    );
  }
  const porNome = new Map(lista.map((f) => [f.definicao.name, f]));
  return {
    definicoes: comStrict(lista),
    async executar(nome, input) {
      const f = porNome.get(nome);
      if (!f) throw new Error(`Ferramenta indisponível no Modo Escola: ${nome}`);
      return f.executar(input ?? {});
    },
  };
}

export function criarFerramentas(banco, agenda = null, whatsapp = null, computador = null, toledo = null, clima = null, instagram = null, escola = null) {
  const ferramentas = [
    // ---------- Notas ----------
    {
      definicao: {
        name: "salvar_nota",
        description: "Salva uma anotação do usuário (ideia, informação, lista de compras etc.).",
        input_schema: obj({ texto: { type: "string", description: "Conteúdo da nota" } }),
      },
      executar: ({ texto }) => banco.adicionarNota(texto),
    },
    {
      definicao: {
        name: "listar_notas",
        description: "Lista todas as anotações salvas, da mais recente para a mais antiga.",
        input_schema: obj({}),
      },
      executar: () => banco.listarNotas(),
    },
    {
      definicao: {
        name: "apagar_nota",
        description: "Apaga uma anotação pelo id. Use listar_notas antes para descobrir o id.",
        input_schema: obj({ id: { type: "string" } }),
      },
      executar: async ({ id }) => ({ apagada: await banco.apagarNota(id) }),
    },

    // ---------- Lembretes ----------
    {
      definicao: {
        name: "criar_lembrete",
        description:
          "Cria um lembrete que será avisado em voz alta (e no WhatsApp) na data e hora indicadas. " +
          "Calcule a data a partir do horário atual informado na mensagem do usuário. " +
          "Para lembretes que se repetem (\"todo dia\", \"de segunda a sexta\", \"toda segunda\", \"todo dia 10\"), use repetir e coloque em quando a PRIMEIRA vez.",
        input_schema: obj({
          texto: { type: "string", description: "O que lembrar" },
          quando: {
            type: "string",
            description: "Data e hora no formato ISO 8601 com fuso, ex.: 2026-11-21T15:30:00-03:00",
          },
          repetir: {
            type: "string",
            enum: ["nao", "diario", "dias_uteis", "semanal", "mensal"],
            description: "nao = uma vez só; diario = todo dia; dias_uteis = segunda a sexta; semanal = toda semana no mesmo dia; mensal = todo mês no mesmo dia",
          },
        }),
      },
      executar: ({ texto, quando, repetir }) => banco.adicionarLembrete(texto, quando, repetir),
    },
    {
      definicao: {
        name: "listar_lembretes",
        description: "Lista os lembretes pendentes, do mais próximo para o mais distante.",
        input_schema: obj({}),
      },
      executar: () => banco.listarLembretes(),
    },
    {
      definicao: {
        name: "concluir_lembrete",
        description: "Marca um lembrete como concluído pelo id. Num lembrete que se repete, isso para de repetir.",
        input_schema: obj({ id: { type: "string" } }),
      },
      executar: async ({ id }) => ({ concluido: await banco.concluirLembrete(id) }),
    },

    // ---------- Finanças ----------
    {
      definicao: {
        name: "registrar_transacao",
        description:
          "Registra um gasto (saida) ou um ganho (entrada) em reais. " +
          "Escolha uma categoria curta em minúsculas, ex.: alimentação, transporte, moradia, lazer, saúde, salário, vendas.",
        input_schema: obj({
          tipo: { type: "string", enum: ["entrada", "saida"] },
          valor: { type: "number", description: "Valor em reais, positivo" },
          categoria: { type: "string" },
          descricao: { type: "string" },
          data: {
            type: "string",
            description: "Data AAAA-MM-DD. Use string vazia para hoje.",
          },
        }),
      },
      executar: (input) => banco.adicionarTransacao({ ...input, data: input.data || undefined }),
    },
    {
      definicao: {
        name: "resumo_financeiro",
        description: "Resumo de um mês: total de entradas, saídas, saldo e gastos por categoria.",
        input_schema: obj({
          mes: { type: "string", description: "Mês AAAA-MM. Use string vazia para o mês atual." },
        }),
      },
      executar: ({ mes }) => banco.resumoFinanceiro(mes || undefined),
    },
    {
      definicao: {
        name: "listar_transacoes",
        description: "Lista as transações mais recentes, opcionalmente de um mês.",
        input_schema: obj({
          mes: { type: "string", description: "Mês AAAA-MM, ou string vazia para todos." },
          limite: { type: "integer", description: "Quantidade máxima, ex.: 20" },
        }),
      },
      executar: ({ mes, limite }) => banco.listarTransacoes({ mes: mes || undefined, limite: limite || 20 }),
    },
    {
      definicao: {
        name: "apagar_transacao",
        description: "Apaga uma transação pelo id. Use listar_transacoes antes para descobrir o id.",
        input_schema: obj({ id: { type: "string" } }),
      },
      executar: async ({ id }) => ({ apagada: await banco.apagarTransacao(id) }),
    },
  ];

  // ---------- Google Agenda ----------
  if (agenda) {
    const dataHora = (descricao) => ({ type: "string", description: `${descricao} em ISO 8601 com fuso, ex.: 2026-11-21T15:30:00-03:00` });
    ferramentas.push(
      {
        definicao: {
          name: "agenda_listar_eventos",
          description: "Lista os compromissos do Google Agenda do usuário entre duas datas/horas.",
          input_schema: obj({ inicio: dataHora("Início do período"), fim: dataHora("Fim do período") }),
        },
        executar: ({ inicio, fim }) => agenda.listarEventos(inicio, fim),
      },
      {
        definicao: {
          name: "agenda_criar_evento",
          description:
            "Cria um compromisso no Google Agenda do usuário. Se ele não disser a duração, use 1 hora. " +
            "Para lembrar o usuário na hora, use criar_lembrete; esta ferramenta é para compromissos da agenda.",
          input_schema: obj({
            titulo: { type: "string" },
            inicio: dataHora("Início"),
            fim: dataHora("Fim"),
            local: { type: "string", description: "Local, ou string vazia" },
            descricao: { type: "string", description: "Detalhes, ou string vazia" },
          }),
        },
        executar: (input) => agenda.criarEvento(input),
      },
      {
        definicao: {
          name: "agenda_apagar_evento",
          description: "Apaga um compromisso do Google Agenda pelo id. Use agenda_listar_eventos antes para achar o id e confirme com o usuário qual evento apagar.",
          input_schema: obj({ id: { type: "string" } }),
        },
        executar: ({ id }) => agenda.apagarEvento(id),
      },
    );
  }

  // ---------- WhatsApp ----------
  if (whatsapp?.configurado) {
    ferramentas.push({
      definicao: {
        name: "enviar_whatsapp",
        description: "Envia uma mensagem de texto para o WhatsApp do próprio usuário (ex.: lista de compras, resumo, anotação). Só use quando ele pedir para mandar algo no WhatsApp.",
        input_schema: obj({ texto: { type: "string", description: "Texto da mensagem, sem markdown" } }),
      },
      executar: ({ texto }) => whatsapp.enviar(texto),
    });
  }

  // ---------- Computador do usuário (programa Jarvis PC) ----------
  if (computador) {
    ferramentas.push({
      definicao: {
        name: "computador",
        description:
          "Executa uma ação no computador (PC) do usuário, pelo programa Jarvis PC. Use quando ele pedir algo \"no PC\" ou \"no computador\". " +
          "Ações: abrir_programa (alvo = nome do programa, ex.: \"Spotify\", \"calculadora\", \"Word\"); " +
          "abrir_site (alvo = endereço completo, ex.: \"https://www.youtube.com\"; para buscas use a página de busca do site); " +
          "volume (alvo = \"subir\", \"descer\", \"mudo\", \"maximo\" ou um número de 0 a 100).",
        input_schema: obj({
          acao: { type: "string", enum: ["abrir_programa", "abrir_site", "volume"] },
          alvo: { type: "string" },
        }),
      },
      executar: ({ acao, alvo }) => computador.executar(acao, alvo),
    });
  }

  // ---------- Modo Escola: o pai/mãe acompanha o progresso da criança ----------
  if (escola) {
    ferramentas.push({
      definicao: {
        name: "progresso_escola",
        description: "Mostra como está o estudo da criança no Modo Escola: estrelas, dias seguidos, exercícios e acertos de hoje, conquistas e provas marcadas.",
        input_schema: obj({}),
      },
      executar: async () => ({ ...(await escola.progresso()), provas: await escola.provasProximas(), relatorioDeHoje: await escola.textoRelatorio() }),
    });
  }

  // ---------- Resumo diário (WhatsApp e Telegram): ligar, desligar, pular, mudar a hora ----------
  ferramentas.push({
    definicao: {
      name: "configurar_resumo_diario",
      description:
        "Liga, desliga, pula ou muda a hora do resumo diário que chega no WhatsApp e no Telegram (o relatório do mês, no dia 1º, segue o mesmo liga/desliga e horário). " +
        "Ações: ligar; desligar; pular_proximo (pula só o próximo: o de hoje, se ainda não chegou a hora, senão o de amanhã); cancelar_pulo; mudar_hora (use hora de 0 a 23); ver (mostra como está). " +
        "Em hora use -1 quando a ação não for mudar_hora.",
      input_schema: obj({
        acao: { type: "string", enum: ["ligar", "desligar", "pular_proximo", "cancelar_pulo", "mudar_hora", "ver"] },
        hora: { type: "integer", description: "Hora do resumo, de 0 a 23; -1 se não for mudar_hora" },
      }),
    },
    executar: ({ acao, hora }) => alterarResumo(banco.armazem, { acao, hora }),
  });

  // ---------- Cidade (previsão do tempo no resumo diário) ----------
  if (clima) {
    ferramentas.push({
      definicao: {
        name: "definir_cidade",
        description: "Guarda a cidade do usuário para a previsão do tempo no resumo diário do WhatsApp. Use quando ele disser onde mora. Formato: \"Cidade, UF\", ex.: \"Montes Claros, MG\".",
        input_schema: obj({ cidade: { type: "string" } }),
      },
      executar: ({ cidade }) => clima.definirCidade(cidade),
    });
  }

  // ---------- Abrir app ou site no aparelho em que o usuário está (celular ou computador) ----------
  ferramentas.push({
    definicao: {
      name: "abrir_no_aparelho",
      description:
        "Mostra na tela um botão para o usuário abrir um app ou site no aparelho que ele está usando agora; no celular Android, abre o próprio app. " +
        "Use para: vídeo ou música (youtube, spotify), rota (waze, google_maps), mandar mensagem a OUTRA pessoa pelo WhatsApp (whatsapp: abre a conversa com o texto pronto, ele toca em enviar), " +
        "ligar para alguém (ligar), perfil do Instagram (instagram), Netflix, abrir um site (site) ou uma pesquisa no Google (pesquisa). " +
        "Campos: busca = o que procurar, o destino da rota, o endereço do site ou o @perfil (\"\" se não houver); numero = telefone com DDD (\"\" se não souber); " +
        "mensagem = texto pronto para o WhatsApp (\"\" se não houver); nome = nome da pessoa (\"\" se não houver).",
      input_schema: obj({
        app: { type: "string", enum: APPS },
        busca: { type: "string" },
        numero: { type: "string" },
        mensagem: { type: "string" },
        nome: { type: "string" },
      }),
    },
    executar: (input) => ({ botao: montarLink(input), aviso: "O botão já está na tela; diga em uma frase para o usuário tocar nele." }),
  });

  if (toledo?.configurado) {
    ferramentas.push({
      definicao: {
        name: "consultar_carteira_toledo",
        description:
          "Consulta o sistema de gestão da Porto e Toledo (aluguéis e vendas de lotes), só para leitura. " +
          "Use para perguntas como: quanto está em atraso e quem deve, o que vence esta semana, quanto entrou no mês, " +
          "como está a venda de um lote, quantos imóveis estão alugados. Não cobra, não dá baixa e não altera nada: " +
          "se o usuário pedir isso, diga que precisa fazer no sistema. Os valores de atraso já incluem multa de 2% e mora de 1% ao mês.",
        input_schema: obj({
          assunto: {
            type: "string",
            enum: ["tudo", "atrasos", "a_receber_mes", "vencendo_7_dias", "recebido_mes", "vendas_lotes", "ocupacao"],
          },
        }),
      },
      executar: ({ assunto }) => toledo.consultar(assunto),
    });
  }
  // ---------- Instagram: comentários e mensagens recebidos ----------
  if (instagram?.configurado) {
    ferramentas.push({
      definicao: {
        name: "instagram_novidades",
        description: "Lista os comentários e mensagens (direct) que chegaram no Instagram da Porto e Toledo nas últimas horas. Só leitura: para responder, o usuário abre o Instagram.",
        input_schema: obj({ horas: { type: "integer", description: "Quantas horas para trás, ex.: 24" } }),
      },
      executar: async ({ horas }) => ({ novidades: (await instagram.recentes(Math.min(Math.max(horas || 24, 1), 168))).slice(0, 20) }),
    });
  }

  // ---------- Documento pronto (jurídico e outros): texto completo com botão de copiar ----------
  ferramentas.push(DOCUMENTO_PRONTO);

  // ---------- Post do Instagram (Porto e Toledo): legenda pronta para copiar ----------
  ferramentas.push({
    definicao: {
      name: "post_instagram",
      description:
        "Mostra na tela um post pronto para o Instagram da Porto e Toledo (aluguéis e venda de lotes), com botão de copiar. " +
        "Use quando pedirem post, legenda, anúncio ou divulgação no Instagram. Se precisar de dados reais (lotes, imóveis), consulte o sistema antes. " +
        "A legenda pode ter emojis e quebras de linha; termine com uma chamada para ação (ex.: chamar no direct ou no WhatsApp). " +
        "Nunca invente preço, metragem ou endereço: se não souber, deixe um espaço como [preço] para o usuário completar.",
      input_schema: obj({
        legenda: { type: "string", description: "Texto do post, pronto para colar, sem as hashtags" },
        hashtags: { type: "string", description: "De 5 a 12 hashtags separadas por espaço, ex.: #lotes #imoveis #montesclaros" },
        melhor_horario: { type: "string", description: "Sugestão curta de dia e hora para postar, ex.: \"terça às 19h\" (\"\" se não souber)" },
      }),
    },
    executar: ({ legenda, hashtags, melhor_horario }) => {
      const texto = [String(legenda ?? "").trim(), String(hashtags ?? "").trim()].filter(Boolean).join("\n\n").slice(0, 2200);
      if (!texto) throw new Error("O post ficou vazio.");
      return { post: { texto, melhor_horario: String(melhor_horario ?? "").trim() }, aviso: "O post já está na tela com o botão de copiar; não leia a legenda em voz alta, só diga que está pronto e o melhor horário." };
    },
  });

  const porNome = new Map(ferramentas.map((f) => [f.definicao.name, f]));

  return {
    definicoes: comStrict(ferramentas),
    async executar(nome, input) {
      const f = porNome.get(nome);
      if (!f) throw new Error(`Ferramenta desconhecida: ${nome}`);
      return f.executar(input ?? {});
    },
  };
}
