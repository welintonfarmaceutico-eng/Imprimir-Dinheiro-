// O "cérebro" do Jarvis: conversa com o Claude e executa as ferramentas.
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
- Criar, listar e concluir lembretes. Eles serão avisados em voz alta na hora marcada.
- Controle financeiro: registrar gastos e ganhos, listar transações e fazer resumos do mês.

Regras:
- Quando o usuário mencionar um gasto ou ganho ("gastei 30 no almoço", "recebi 2 mil"), registre sem pedir confirmação e confirme em uma frase.
- Para apagar algo, primeiro liste para descobrir o id. Se houver dúvida sobre qual item apagar, pergunte.
- Se não souber algo e não puder pesquisar, diga isso com honestidade.`;
}

export class Cerebro {
  constructor(ferramentas) {
    this.cliente = new Anthropic();
    this.ferramentas = ferramentas;
    this.conversas = new Map(); // id -> histórico de mensagens
    this.sistema = promptDeSistema(); // fixo: mantém o cache de prompt
    this.tools = [
      { type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "BR", timezone: process.env.TZ } },
      ...ferramentas.definicoes,
    ];
  }

  historico(id) {
    if (!this.conversas.has(id)) this.conversas.set(id, []);
    return this.conversas.get(id);
  }

  limpar(id) {
    this.conversas.delete(id);
  }

  agora() {
    return new Date().toLocaleString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }) + ` (ISO: ${isoLocal(new Date())})`;
  }

  // Envia uma mensagem e devolve { texto, acoes }.
  async conversar(id, textoUsuario) {
    const mensagens = this.historico(id);
    const inicio = mensagens.length;
    mensagens.push({ role: "user", content: `[Agora: ${this.agora()}]\n${textoUsuario}` });
    const acoes = []; // ferramentas usadas, para a interface atualizar os painéis

    try {
      for (let volta = 0; volta < MAX_VOLTAS; volta++) {
        const resposta = await this.cliente.beta.messages.create({
          model: MODELO,
          max_tokens: 16000,
          system: this.sistema,
          tools: this.tools,
          messages: mensagens,
          output_config: { effort: ESFORCO },
          cache_control: { type: "ephemeral" },
          // Se o modelo recusar por engano, o próprio servidor tenta outro modelo.
          betas: ["server-side-fallback-2026-07-01", "compact-2026-01-12"],
          fallbacks: "default",
          // Resume conversas muito longas automaticamente.
          context_management: { edits: [{ type: "compact_20260112" }] },
        });

        if (resposta.stop_reason === "refusal") {
          mensagens.length = inicio; // descarta a pergunta recusada
          return { texto: "Desculpe, não posso ajudar com isso.", acoes };
        }

        // Guarda a resposta completa, sem alterar nada (exigido pela API).
        mensagens.push({ role: "assistant", content: resposta.content });

        if (resposta.stop_reason === "pause_turn") continue; // busca longa: continua

        const chamadas = resposta.content.filter((b) => b.type === "tool_use");
        if (resposta.stop_reason !== "tool_use" || chamadas.length === 0) {
          const texto = resposta.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim();
          return { texto: texto || "Pronto.", acoes };
        }

        const resultados = [];
        for (const chamada of chamadas) {
          acoes.push(chamada.name);
          try {
            const r = await this.ferramentas.executar(chamada.name, chamada.input);
            resultados.push({ type: "tool_result", tool_use_id: chamada.id, content: JSON.stringify(r) });
          } catch (erro) {
            resultados.push({ type: "tool_result", tool_use_id: chamada.id, is_error: true, content: String(erro.message || erro) });
          }
        }
        mensagens.push({ role: "user", content: resultados });
      }
      return { texto: "Essa tarefa ficou longa demais. Pode reformular de um jeito mais simples?", acoes };
    } catch (erro) {
      mensagens.length = inicio; // não deixa o histórico pela metade
      throw erro;
    }
  }
}

// Data/hora local em ISO 8601 com o fuso, ex.: 2026-11-21T15:30:00-03:00
function isoLocal(d) {
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sinal = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${sinal}${p(off / 60)}:${p(off % 60)}`;
}
