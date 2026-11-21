// Ferramentas que o Jarvis pode usar: notas, lembretes e finanças.
// Cada ferramenta tem a definição enviada ao Claude e a função que executa.

const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export function criarFerramentas(banco, agenda = null, whatsapp = null) {
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
          "Cria um lembrete que será avisado em voz alta na data e hora indicadas. " +
          "Calcule a data a partir do horário atual informado na mensagem do usuário.",
        input_schema: obj({
          texto: { type: "string", description: "O que lembrar" },
          quando: {
            type: "string",
            description: "Data e hora no formato ISO 8601 com fuso, ex.: 2026-11-21T15:30:00-03:00",
          },
        }),
      },
      executar: ({ texto, quando }) => banco.adicionarLembrete(texto, quando),
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
        description: "Marca um lembrete como concluído pelo id.",
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

  const porNome = new Map(ferramentas.map((f) => [f.definicao.name, f]));

  return {
    definicoes: ferramentas.map((f) => ({ ...f.definicao, strict: true })),
    async executar(nome, input) {
      const f = porNome.get(nome);
      if (!f) throw new Error(`Ferramenta desconhecida: ${nome}`);
      return f.executar(input ?? {});
    },
  };
}
