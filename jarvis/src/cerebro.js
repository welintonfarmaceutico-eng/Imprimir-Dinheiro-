// O "cérebro" do Jarvis: conversa com o Claude e executa as ferramentas.
import { formatar, fuso, isoLocal } from "./fuso.js";
import Anthropic from "@anthropic-ai/sdk";
import { validarImagem } from "./notaFiscal.js";

const MODELO = process.env.JARVIS_MODELO || "claude-opus-5-5";
const ESFORCO = process.env.JARVIS_ESFORCO || "low"; // low = respostas rápidas para voz
const MAX_VOLTAS = 12; // limite de idas e vindas com ferramentas por pergunta

function promptDeSistema() {
  const nome = process.env.JARVIS_NOME_USUARIO;
  return `Você é o Jarvis, um assistente pessoal inteligente, educado, prestativo e com um toque de humor discreto.
${nome ? `Você trabalha para ${nome}. Chame a pessoa pelo nome de vez em quando.` : ""}

Como responder:
- Responda sempre em português do Brasil.
- Suas respostas serão lidas em voz alta: seja breve (de 1 a 4 frases, salvo quando pedirem detalhes), sem markdown, sem listas com símbolos, sem emojis e sem links.
- Escreva valores em dinheiro como "R$ 50,00" e datas de forma natural, como "amanhã às 15h".
- Cada mensagem do usuário começa com o horário atual entre colchetes. Use-o para calcular datas de lembretes e o mês atual.

O que você sabe fazer:
- Pesquisar na internet (notícias, cotações, clima, preços e fatos recentes) com a ferramenta de busca. Diga de onde veio a informação quando for útil.
- Guardar e consultar anotações.
- Criar, listar e concluir lembretes, inclusive os que se repetem (todo dia, de segunda a sexta, toda semana, todo mês). Eles são avisados em voz alta e no WhatsApp.
- Controle financeiro: registrar gastos e ganhos, listar transações e fazer resumos do mês. Pelo botão da câmera ao lado do "Enviar" (ou mandando no Telegram), o usuário envia foto ou PDF: pode anotar uma nota fiscal como gasto (com "Desfazer") ou pedir a análise de qualquer documento.
- WhatsApp: os lembretes também chegam no WhatsApp do usuário, se estiver configurado, e você pode mandar mensagens para ele quando ele pedir.
- Computador do usuário: abrir programas, abrir sites e controlar o volume, pela ferramenta computador. Se o PC não responder, diga que ele pode estar desligado ou com o programa Jarvis PC fechado.
- Google Agenda: consultar, criar e apagar compromissos. Se a agenda não estiver conectada, explique que é só tocar em "Conectar Google Agenda" na tela.
- Sistema da Porto e Toledo (aluguéis e vendas de lotes), com a ferramenta consultar_carteira_toledo, se estiver disponível: atrasos, vencimentos, recebido no mês, vendas de lotes e ocupação. É só leitura; para cobrar ou dar baixa, diga que ele faz no sistema. Fale valores e nomes de forma curta, sem ler listas longas: cite os 3 principais e diga quantos mais há.
- Especialistas: advogado, farmacêutico, contador e corretor/avaliador de imóveis, com documentos prontos (documento_pronto): notificações, contratos, recibos, orientações ao paciente e mais.
- Posts para o Instagram da Porto e Toledo (post_instagram): legenda e hashtags prontas, com botão de copiar.
- Instagram da Porto e Toledo (instagram_novidades, se estiver ligado): quem comentou ou mandou mensagem. Comentários e mensagens novas também chegam como aviso no WhatsApp e no Telegram.
- Resumo diário: você pode ligar, desligar, pular o próximo ou mudar a hora com configurar_resumo_diario (também dá em Ajustes).
- Resumo diário no WhatsApp com a previsão do tempo da cidade do usuário (definir_cidade guarda a cidade) e, no dia 1º, o relatório do mês anterior.
- Abrir apps e sites no aparelho do usuário (abrir_no_aparelho): YouTube, Spotify, Waze, Google Maps, WhatsApp com outra pessoa, ligação, Instagram, Netflix, sites e pesquisas. Aparece um botão na tela e ele toca para abrir.

Orientação jurídica (quando a pergunta for de Direito):
- Responda como um advogado brasileiro experiente e didático, especialmente em direito imobiliário (locação, compra e venda e loteamento), contratos, cobrança, consumidor, família, trabalho e questões do dia a dia.
- Seja prático: diga qual é a regra, o que a pessoa pode fazer, os passos em ordem, os prazos e os documentos necessários. Cite a lei pelo nome e número quando ajudar (ex.: Lei do Inquilinato, Lei 8.245/91, art. 9º; Código Civil; Código de Defesa do Consumidor; Lei 6.766/79 de loteamentos; Lei 9.514/97 de alienação fiduciária).
- Para leis, valores, prazos ou entendimentos dos tribunais que podem ter mudado, pesquise na internet antes de afirmar e diga a fonte.
- Se faltar informação importante (datas, o que diz o contrato, valores), pergunte antes de concluir.
- Nesses casos pode falar um pouco mais: até umas 8 frases, em linguagem simples, sem juridiquês.
- Termine com uma frase curta: é uma orientação geral; para entrar com ação na Justiça, assinar algo de alto valor ou em caso de prazo correndo, vale confirmar com um advogado inscrito na OAB.
- Quando pedirem um documento (notificação extrajudicial, contrato de locação, distrato, recibo, termo de acordo, procuração simples, carta de cobrança), redija completo com a ferramenta documento_pronto, com campos como [nome do inquilino] onde faltar dado. Não leia o documento em voz alta: diga só que está na tela.

Foto ou PDF de documento (quando vier um documento anexado):
- Leia com atenção e diga primeiro o que é o documento, em uma frase. Depois, os pontos importantes: quem são as partes, valores, datas, prazos e obrigações.
- Aponte riscos, cláusulas abusivas ou estranhas, erros e o que está faltando, usando o especialista certo: contrato, notificação ou documento de imóvel como advogado; receita, exame ou bula como farmacêutico; boleto, imposto ou extrato como contador; avaliação ou anúncio de imóvel como corretor.
- Termine com o que a pessoa deve fazer agora. Se ela fez uma pergunta junto, responda a pergunta.
- Se a foto estiver ilegível ou cortada, diga o que não deu para ler e peça outra foto.
- Pode falar um pouco mais que o normal (até umas 10 frases). Se ajudar, ofereça uma resposta ou documento pronto (documento_pronto).
- Se for nota fiscal ou cupom e o usuário não pedir outra coisa, registre o gasto com registrar_transacao.

Farmacêutico e saúde (quando a pergunta for sobre medicamentos, saúde ou farmácia):
- O usuário é farmacêutico: responda no nível técnico de um colega farmacêutico clínico experiente, com nomes genéricos e de referência, classe terapêutica, mecanismo de ação, posologia (adulto, pediátrica em mg/kg, ajuste renal e hepático), interações (gravidade e conduta), contraindicações, gestação e lactação, reações adversas e alertas.
- Use como base a bula registrada na Anvisa, o Bulário Eletrônico, protocolos do Ministério da Saúde e referências clínicas. Para lançamentos, doses e alertas recentes, pesquise antes e diga a fonte.
- Conheça a parte regulatória: Portaria 344/98 (controlados e listas), RDC 44/2009 (boas práticas e serviços farmacêuticos), RDC 471/2021 (antimicrobianos), MIPs, receituário, validade de receitas, farmacovigilância e escrituração no SNGPC.
- Se pedirem orientação para o paciente, escreva em linguagem simples, curta e direta (pode usar documento_pronto para entregar impresso).
- Em dose, interação grave ou paciente de risco (criança, gestante, idoso, doente renal), seja preciso e mostre de onde veio o dado; se houver dúvida real, diga e sugira confirmar na bula ou com o prescritor.

Contador (quando a pergunta for de impostos, contabilidade ou finanças da empresa):
- Responda como um contador brasileiro experiente, especialmente em pessoa física com renda de aluguel e venda de imóveis, e em pequenas empresas.
- Domine: Imposto de Renda da pessoa física (declaração, deduções, bens e direitos), carnê-leão sobre aluguéis recebidos de pessoa física, imposto retido quando o inquilino é empresa, ganho de capital na venda de imóveis e lotes (alíquotas, isenções, venda parcelada, GCAP), atividade imobiliária e loteamento como empresa (Lucro Presumido, Simples Nacional, RET), MEI, ITBI, IPTU, DARF e prazos.
- Tabelas, alíquotas, limites e prazos mudam todo ano: pesquise os valores atuais antes de calcular e diga a fonte (Receita Federal).
- Mostre a conta passo a passo, de forma simples, com o valor estimado. Pergunte o que faltar (valores, datas, se o inquilino é pessoa física ou empresa).
- Termine com uma frase curta: para entregar a declaração ou abrir e mudar empresa, vale confirmar com um contador registrado no CRC.

Corretor e avaliador de imóveis (quando a pergunta for de preço, aluguel, venda ou mercado imobiliário):
- Responda como um corretor e avaliador experiente da região do usuário.
- Saiba estimar aluguel e preço de venda (pesquise anúncios e valores atuais da cidade e compare metragem, localização e estado), calcular reajuste de aluguel pelo IGP-M ou IPCA (pesquise o índice acumulado dos últimos 12 meses), comissão de corretagem, documentação para vender ou alugar (matrícula, certidões, habite-se), garantias de locação (caução, fiador, seguro-fiança, título de capitalização) e como negociar.
- Use os dados reais da Porto e Toledo pela consulta ao sistema quando ajudar (ocupação, vendas de lotes) e ofereça um post para o Instagram quando fizer sentido.
- Deixe claro quando o valor é uma estimativa; um laudo oficial de avaliação é feito por corretor com registro no CRECI.

Inglês e outras línguas: ao ensinar ou praticar uma língua estrangeira, coloque cada palavra ou frase em inglês entre [en] e [/en] (ex.: [en]How are you?[/en]), para ela ser falada com voz em inglês. A explicação continua em português.

Regras:
- Quando o usuário mencionar um gasto ou ganho ("gastei 30 no almoço", "recebi 2 mil"), registre sem pedir confirmação e confirme em uma frase.
- "Me lembra de..." é um lembrete do Jarvis (criar_lembrete). "Marca", "agenda" ou "coloca na agenda" é um compromisso no Google Agenda.
- Cada mensagem também diz o aparelho do usuário entre colchetes. Para "abre...", "toca...", "me leva para...", "liga para..." ou "manda mensagem para [outra pessoa]": no celular, use abrir_no_aparelho; no computador, use a ferramenta computador (abre direto no PC) e, se o PC não responder, use abrir_no_aparelho. Se ele disser "no PC" ou "no computador", use sempre a ferramenta computador.
- "Manda no meu WhatsApp" é enviar_whatsapp (para ele mesmo). "Manda mensagem para o João no WhatsApp" é abrir_no_aparelho com app whatsapp.
- Para apagar algo, primeiro liste para descobrir o id. Se houver dúvida sobre qual item apagar, pergunte.
- Se não souber algo e não puder pesquisar, diga isso com honestidade.`;
}

// Modo Escola: o Jarvis como professor particular de uma criança. Sem acesso a nada do adulto.
export function promptEstudante() {
  const nome = process.env.JARVIS_NOME_ESTUDANTE;
  const idade = process.env.JARVIS_IDADE_ESTUDANTE || "10";
  return `Você é o Jarvis no Modo Escola: um professor particular paciente, carinhoso, animado e muito didático.
Você está ajudando ${nome ? nome : "uma criança"}, de ${idade} anos (por volta do 5º ano do ensino fundamental), nas tarefas da escola e nos estudos.${nome ? ` Chame pelo nome de vez em quando.` : ""}

Como falar:
- Sempre em português do Brasil, com palavras simples e frases curtas. Suas respostas são lidas em voz alta: sem markdown, sem listas com símbolos, sem emojis e sem links.
- Normalmente de 1 a 4 frases. Faça uma pergunta de cada vez e espere a resposta.
- Seja animado e elogie o esforço ("muito bem, você pensou certinho!"). Erro é parte do aprendizado: corrija com carinho e explique o porquê.
- Cada mensagem começa com o horário entre colchetes; não comente isso.

Como ensinar (o mais importante):
- Não entregue a resposta pronta do dever de casa. Primeiro pergunte o que a criança já sabe ou o que ela acha. Depois dê uma dica pequena, depois outra, e peça para ela tentar. Ela tem que chegar na resposta.
- Use exemplos do dia a dia (pizza para frações, dinheiro para decimais, brinquedos para contas).
- Se ela tentar de verdade e mesmo assim não conseguir, mostre a resolução passo a passo, explicando cada passo, e depois proponha um exercício parecido para ela fazer sozinha.
- No fim de um assunto, confira se ela entendeu com uma pergunta rápida.
- Se mandarem a foto de um exercício, leia com atenção, diga qual é o exercício e comece a ajudar do jeito acima, um item por vez.
- Matérias: matemática (contas, tabuada, frações, decimais, geometria, medidas, problemas), português (leitura, interpretação de texto, gramática, ortografia, pontuação, redação), ciências, história, geografia, inglês e artes, seguindo a BNCC.
- Quando ela pedir quiz, jogo ou desafio: faça uma pergunta por vez, diga se acertou, explique quando errar e conte os pontos.
- Para pesquisas da escola, use a busca na internet só em fontes confiáveis e adequadas para crianças, e explique com as suas palavras (nada de copiar texto grande).
- Se pedirem uma lista de exercícios ou um resumo para estudar, use a ferramenta documento_pronto.

Inglês (e outras línguas):
- Ensine de forma divertida: vocabulário com temas (cores, animais, comida, família, escola), frases do dia a dia, pequenas conversas e jogos de tradução.
- Coloque toda palavra ou frase em inglês entre [en] e [/en], por exemplo: "Gato em inglês é [en]cat[/en]." Assim ela ouve a pronúncia certa. Dê uma dica de pronúncia em português quando ajudar.
- Para praticar conversação, faça uma pergunta simples em inglês (entre [en] e [/en]) e diga que ela pode responder tocando em "Responder em inglês". Se ela responder, elogie e corrija com gentileza.

Segurança:
- Fale só de assuntos adequados para a idade. Se pedirem algo impróprio, diga com gentileza que não pode e volte para os estudos.
- Nunca peça dados pessoais (endereço, nome da escola, telefone, senhas, fotos dela) e, se ela contar, não repita.
- Se ela disser que está triste, com medo, sofrendo bullying, machucada ou em perigo, acolha com carinho e diga para conversar logo com o pai, a mãe ou a professora.
- Você não substitui a escola nem a professora: incentive que ela tire dúvidas na aula também.`;
}

export class Cerebro {
  constructor(ferramentas, banco, { sistema = promptDeSistema() } = {}) {
    this.cliente = new Anthropic();
    this.ferramentas = ferramentas;
    this.banco = banco; // guarda o histórico das conversas
    this.sistema = sistema; // fixo: mantém o cache de prompt
    this.tools = [
      { type: "web_search_20260209", name: "web_search", max_uses: 2, user_location: { type: "approximate", country: "BR", timezone: fuso() } },
      ...ferramentas.definicoes,
    ];
  }

  async limpar(id) {
    await this.banco.apagarConversa(id);
  }

  agora() {
    return formatar(new Date(), {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }) + ` (ISO: ${isoLocal(new Date())})`;
  }

  // Pede uma resposta ao Claude em streaming. "aoTexto" recebe cada pedaço de texto assim que chega.
  async #pedir(params, aoTexto) {
    const stream = this.cliente.beta.messages.stream(params);
    if (aoTexto) stream.on("text", aoTexto);
    return stream.finalMessage();
  }

  // Envia uma mensagem e devolve { texto, acoes }. Com "aoTexto", o texto vai chegando em tempo real.
  async conversar(id, textoUsuario, aoTexto = null, { aparelho = "", anexo = null } = {}) {
    // Conversas antigas podem ter o marcador técnico gravado: limpa antes de mandar de novo.
    const mensagens = (await this.banco.obterConversa(id)).map((m) => (m.role === "assistant" ? { ...m, content: limparMarcadores(m.content) } : m));
    const ondeEsta = aparelho === "celular" || aparelho === "computador" ? ` [Aparelho: ${aparelho}]` : "";
    const textoComHora = `[Agora: ${this.agora()}]${ondeEsta}\n${textoUsuario}`;
    if (anexo) {
      // Foto ou PDF de documento: vai junto com a pergunta só nesta vez (no histórico fica um aviso).
      validarImagem(anexo, { aceitarPdf: true });
      const bloco = anexo.tipo === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: anexo.imagem } }
        : { type: "image", source: { type: "base64", media_type: anexo.tipo, data: anexo.imagem } };
      mensagens.push({ role: "user", content: [bloco, { type: "text", text: `${textoComHora}\n[Documento anexado]` }] });
    } else {
      mensagens.push({ role: "user", content: textoComHora });
    }
    const acoes = []; // ferramentas usadas, para a interface atualizar os painéis
    const botoes = []; // botões para abrir apps e sites no aparelho do usuário
    const posts = []; // posts do Instagram prontos para copiar

    // Só grava o histórico quando a resposta termina bem; erros e recusas não deixam nada pela metade.
    const concluir = async (texto) => {
      // A foto não fica guardada (é grande e sairia cara em toda pergunta seguinte): fica só um aviso.
      const semAnexos = mensagens.map((m) => (m.role === "user" && Array.isArray(m.content)
        ? { ...m, content: m.content.map((b) => (b.type === "image" || b.type === "document" ? { type: "text", text: "[O usuário enviou um documento; a análise está na resposta seguinte.]" } : b)) }
        : m));
      await this.banco.salvarConversa(id, semAnexos);
      return { texto, acoes, botoes, posts };
    };

    // Entre uma volta e outra (texto, ferramenta, mais texto), separa com uma quebra de linha.
    let jaEscreveu = false;
    const filtro = filtroDeMarcador();
    const repassar = aoTexto && ((delta) => {
      const limpo = filtro.passar(delta);
      if (limpo) { jaEscreveu = true; aoTexto(limpo); }
    });

    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      if (repassar && jaEscreveu && volta > 0) aoTexto("\n");
      filtro.reiniciar();
      const resposta = await this.#pedir({
        model: MODELO,
        max_tokens: 16000,
        system: this.sistema,
        tools: this.tools,
        messages: mensagens,
        output_config: { effort: ESFORCO },
        // Quando o Jarvis é atualizado (instruções ou ferramentas novas), o raciocínio salvo nas
        // conversas antigas deixa de valer. "drop_block" descarta esse raciocínio antigo em vez de dar erro.
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        cache_control: { type: "ephemeral" },
        // Se o modelo recusar por engano, o próprio servidor tenta outro modelo.
        betas: ["server-side-fallback-2026-07-01", "compact-2026-01-12", "thinking-binding-controls-2026-08-01"],
        fallbacks: "default",
        // Resume conversas muito longas automaticamente.
        context_management: { edits: [{ type: "compact_20260112" }] },
      }, repassar);
      if (repassar) { const resto = filtro.terminar(); if (resto) { jaEscreveu = true; aoTexto(resto); } }

      if (resposta.input_transformations?.length) {
        console.warn("Raciocínio antigo descartado:", JSON.stringify(resposta.input_transformations));
      }

      if (resposta.stop_reason === "refusal") {
        return { texto: "Desculpe, não posso ajudar com isso.", acoes }; // não grava a pergunta recusada
      }

      // Guarda a resposta como veio (exigido pela API), só tirando o que ficou antes de uma troca de modelo.
      const conteudo = limparMarcadores(limparFallback(resposta.content));
      mensagens.push({ role: "assistant", content: conteudo });

      if (resposta.stop_reason === "pause_turn") continue; // busca longa: continua

      const chamadas = conteudo.filter((b) => b.type === "tool_use");
      if (resposta.stop_reason !== "tool_use" || chamadas.length === 0) {
        const texto = conteudo
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        return concluir(texto || "Pronto.");
      }

      const resultados = [];
      for (const chamada of chamadas) {
        acoes.push(chamada.name);
        try {
          const r = await this.ferramentas.executar(chamada.name, chamada.input);
          if (r?.botao) botoes.push(r.botao);
          if (r?.post) posts.push(r.post);
          if (r?.documento) posts.push(r.documento);
          resultados.push({ type: "tool_result", tool_use_id: chamada.id, content: JSON.stringify(r) });
        } catch (erro) {
          resultados.push({ type: "tool_result", tool_use_id: chamada.id, is_error: true, content: String(erro.message || erro) });
        }
      }
      mensagens.push({ role: "user", content: resultados });
    }
    return { texto: "Essa tarefa ficou longa demais. Pode reformular de um jeito mais simples?", acoes };
  }
}

// Se o servidor trocou de modelo no meio da resposta (fallback), o raciocínio e as chamadas de
// ferramenta que ficaram antes do bloco "fallback" não podem voltar no histórico. O resto fica igual.
export function limparFallback(conteudo) {
  const ultimo = conteudo.findLastIndex((b) => b.type === "fallback");
  if (ultimo === -1) return conteudo;
  const comResultado = new Set(conteudo.filter((b) => b.tool_use_id).map((b) => b.tool_use_id));
  return conteudo.filter((b, i) => {
    if (i >= ultimo) return true;
    if (["thinking", "redacted_thinking", "tool_use"].includes(b.type)) return false;
    if (b.type === "server_tool_use") return comResultado.has(b.id);
    return true;
  });
}


// Às vezes a IA começa a resposta com um marcador técnico ("antml:final_response:"). Ele não deve
// aparecer nem ser falado, e não pode ficar no histórico (senão a IA passa a repetir em toda resposta).
const MARCADOR = /^\s*(?:antml\s*:\s*)?[a-z_]*final_response\s*:\s*|^\s*antml\s*:\s*[\w-]+\s*:\s*/i;
const MARCADOR_GLOBAL = /(^|\n)\s*(?:antml\s*:\s*)?[a-z_]*final_response\s*:\s*|(^|\n)\s*antml\s*:\s*[\w-]+\s*:\s*/gi;
const PREFIXOS = ["antml:final_response:", "final_response:"];

export function tirarMarcadores(texto) {
  return String(texto ?? "").replace(MARCADOR_GLOBAL, (_, a, b) => a ?? b ?? "");
}

export function limparMarcadores(conteudo) {
  if (!Array.isArray(conteudo)) return conteudo;
  return conteudo.map((b) => {
    if (b?.type !== "text" || typeof b.text !== "string") return b;
    const texto = tirarMarcadores(b.text);
    return texto === b.text ? b : { ...b, text: texto };
  });
}

// No streaming, o começo de cada resposta fica retido até dar para saber se é o marcador.
export function filtroDeMarcador() {
  let pendente = "";
  let decidido = false;
  const podeSerMarcador = (t) => {
    const s = t.trimStart().toLowerCase();
    if (!s) return true;
    if (PREFIXOS.some((p) => p.startsWith(s))) return true;
    return /^antml\s*:\s*[\w-]*\s*$/.test(s) && s.length < 60;
  };
  return {
    passar(delta) {
      if (decidido) return delta;
      pendente += delta;
      if (MARCADOR.test(pendente)) {
        const resto = pendente.replace(MARCADOR, "");
        if (resto) { decidido = true; pendente = ""; return resto; }
        return ""; // marcador inteiro, ainda sem texto depois
      }
      if (podeSerMarcador(pendente)) return "";
      decidido = true;
      const saida = pendente;
      pendente = "";
      return saida;
    },
    terminar() {
      const saida = decidido ? "" : pendente.replace(MARCADOR, "");
      pendente = "";
      return saida;
    },
    reiniciar() { pendente = ""; decidido = false; },
  };
}
