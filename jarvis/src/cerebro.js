// O "cérebro" do Jarvis: conversa com o Claude e executa as ferramentas.
import { formatar, fuso, isoLocal } from "./fuso.js";
import Anthropic from "@anthropic-ai/sdk";

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
- Controle financeiro: registrar gastos e ganhos, listar transações e fazer resumos do mês.
- WhatsApp: os lembretes também chegam no WhatsApp do usuário, se estiver configurado, e você pode mandar mensagens para ele quando ele pedir.
- Computador do usuário: abrir programas, abrir sites e controlar o volume, pela ferramenta computador. Se o PC não responder, diga que ele pode estar desligado ou com o programa Jarvis PC fechado.
- Google Agenda: consultar, criar e apagar compromissos. Se a agenda não estiver conectada, explique que é só tocar em "Conectar Google Agenda" na tela.
- Sistema da Porto e Toledo (aluguéis e vendas de lotes), com a ferramenta consultar_carteira_toledo, se estiver disponível: atrasos, vencimentos, recebido no mês, vendas de lotes e ocupação. É só leitura; para cobrar ou dar baixa, diga que ele faz no sistema. Fale valores e nomes de forma curta, sem ler listas longas: cite os 3 principais e diga quantos mais há.
- Resumo diário no WhatsApp com a previsão do tempo da cidade do usuário (definir_cidade guarda a cidade) e, no dia 1º, o relatório do mês anterior.
- Abrir apps e sites no aparelho do usuário (abrir_no_aparelho): YouTube, Spotify, Waze, Google Maps, WhatsApp com outra pessoa, ligação, Instagram, Netflix, sites e pesquisas. Aparece um botão na tela e ele toca para abrir.

Regras:
- Quando o usuário mencionar um gasto ou ganho ("gastei 30 no almoço", "recebi 2 mil"), registre sem pedir confirmação e confirme em uma frase.
- "Me lembra de..." é um lembrete do Jarvis (criar_lembrete). "Marca", "agenda" ou "coloca na agenda" é um compromisso no Google Agenda.
- Cada mensagem também diz o aparelho do usuário entre colchetes. Para "abre...", "toca...", "me leva para...", "liga para..." ou "manda mensagem para [outra pessoa]": no celular, use abrir_no_aparelho; no computador, use a ferramenta computador (abre direto no PC) e, se o PC não responder, use abrir_no_aparelho. Se ele disser "no PC" ou "no computador", use sempre a ferramenta computador.
- "Manda no meu WhatsApp" é enviar_whatsapp (para ele mesmo). "Manda mensagem para o João no WhatsApp" é abrir_no_aparelho com app whatsapp.
- Para apagar algo, primeiro liste para descobrir o id. Se houver dúvida sobre qual item apagar, pergunte.
- Se não souber algo e não puder pesquisar, diga isso com honestidade.`;
}

export class Cerebro {
  constructor(ferramentas, banco) {
    this.cliente = new Anthropic();
    this.ferramentas = ferramentas;
    this.banco = banco; // guarda o histórico das conversas
    this.sistema = promptDeSistema(); // fixo: mantém o cache de prompt
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
  async conversar(id, textoUsuario, aoTexto = null, { aparelho = "" } = {}) {
    const mensagens = await this.banco.obterConversa(id);
    const ondeEsta = aparelho === "celular" || aparelho === "computador" ? ` [Aparelho: ${aparelho}]` : "";
    mensagens.push({ role: "user", content: `[Agora: ${this.agora()}]${ondeEsta}\n${textoUsuario}` });
    const acoes = []; // ferramentas usadas, para a interface atualizar os painéis
    const botoes = []; // botões para abrir apps e sites no aparelho do usuário

    // Só grava o histórico quando a resposta termina bem; erros e recusas não deixam nada pela metade.
    const concluir = async (texto) => {
      await this.banco.salvarConversa(id, mensagens);
      return { texto, acoes, botoes };
    };

    // Entre uma volta e outra (texto, ferramenta, mais texto), separa com uma quebra de linha.
    let jaEscreveu = false;
    const repassar = aoTexto && ((delta) => { jaEscreveu = true; aoTexto(delta); });

    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      if (repassar && jaEscreveu && volta > 0) aoTexto("\n");
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

      if (resposta.input_transformations?.length) {
        console.warn("Raciocínio antigo descartado:", JSON.stringify(resposta.input_transformations));
      }

      if (resposta.stop_reason === "refusal") {
        return { texto: "Desculpe, não posso ajudar com isso.", acoes }; // não grava a pergunta recusada
      }

      // Guarda a resposta como veio (exigido pela API), só tirando o que ficou antes de uma troca de modelo.
      const conteudo = limparFallback(resposta.content);
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

