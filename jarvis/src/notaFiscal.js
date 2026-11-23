// Lê a foto de uma nota fiscal, cupom ou recibo e registra o gasto nas finanças.
// Uma chamada só ao Claude (com a imagem), obrigada a responder pela ferramenta "dados_da_nota".
import { hojeLocal } from "./fuso.js";

const MODELO = process.env.JARVIS_MODELO || "claude-opus-5-5";
const TIPOS = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB de imagem (a tela já reduz a foto antes de mandar)
export const CATEGORIAS = ["alimentação", "transporte", "moradia", "saúde", "lazer", "educação", "compras", "contas", "outros"];

const FERRAMENTA = {
  name: "dados_da_nota",
  description: "Devolve os dados lidos da nota fiscal, cupom ou recibo da foto.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["legivel", "valor_total", "estabelecimento", "categoria", "data", "resumo_itens"],
    properties: {
      legivel: { type: "boolean", description: "false se a foto não for uma nota/cupom/recibo ou se o valor total não der para ler" },
      valor_total: { type: "number", description: "Valor total pago em reais (0 se não der para ler)" },
      estabelecimento: { type: "string", description: "Nome curto da loja ou empresa (\"\" se não aparecer)" },
      categoria: { type: "string", enum: CATEGORIAS },
      data: { type: "string", description: "Data da compra AAAA-MM-DD (\"\" se não aparecer)" },
      resumo_itens: { type: "string", description: "Até 6 palavras sobre o que foi comprado, ex.: \"remédios e higiene\" (\"\" se não der)" },
    },
  },
};

export function validarImagem({ imagem, tipo }, { aceitarPdf = false } = {}) {
  if (!TIPOS.includes(tipo) && !(aceitarPdf && tipo === "application/pdf")) {
    throw new Error(aceitarPdf ? "Mande uma foto (JPG, PNG ou WEBP) ou um PDF." : "Mande uma foto em JPG, PNG ou WEBP.");
  }
  if (typeof imagem !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(imagem)) throw new Error("A foto chegou com defeito. Tente de novo.");
  if (imagem.length * 0.75 > MAX_BYTES) throw new Error(tipo === "application/pdf" ? "O PDF é grande demais (máximo 5 MB)." : "A foto ficou grande demais. Tente de novo mais de perto.");
}

// Pede ao Claude os dados da nota. Devolve os campos da ferramenta.
export async function lerNotaFiscal(cliente, { imagem, tipo }, agora = new Date()) {
  validarImagem({ imagem, tipo });
  const resposta = await cliente.messages.create({
    model: MODELO,
    max_tokens: 1024,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: FERRAMENTA.name },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: tipo, data: imagem } },
        {
          type: "text",
          text: `Hoje é ${hojeLocal(agora)}. Leia esta nota fiscal, cupom ou recibo brasileiro e preencha os dados. ` +
            "Use o VALOR TOTAL pago (não o subtotal nem um item). Farmácia e remédios = saúde; mercado, padaria e restaurante = alimentação; " +
            "combustível, Uber e ônibus = transporte; luz, água, internet e telefone = contas.",
        },
      ],
    }],
  });
  const uso = resposta.content?.find((b) => b.type === "tool_use" && b.name === FERRAMENTA.name);
  if (!uso) throw new Error("Não consegui ler a nota. Tente outra foto.");
  return uso.input;
}

const real = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Lê a nota e registra o gasto. Devolve { texto, transacao } para mostrar e falar.
export async function registrarNotaFiscal(cliente, banco, foto, agora = new Date()) {
  const d = await lerNotaFiscal(cliente, foto, agora);
  if (!d.legivel || !(d.valor_total > 0)) {
    return { texto: "Não consegui ler o valor dessa nota. Tente uma foto mais de perto, com boa luz e a nota inteira aparecendo.", transacao: null };
  }
  const valor = Math.round(d.valor_total * 100) / 100;
  // Data de compra estranha (futura ou de mais de um ano atrás): usa hoje.
  const hoje = hojeLocal(agora);
  const umAnoAtras = `${Number(hoje.slice(0, 4)) - 1}${hoje.slice(4)}`;
  const data = /^\d{4}-\d{2}-\d{2}$/.test(d.data) && d.data <= hoje && d.data >= umAnoAtras ? d.data : hoje;
  const categoria = CATEGORIAS.includes(d.categoria) ? d.categoria : "outros";
  const descricao = [d.estabelecimento, d.resumo_itens].filter(Boolean).join(" - ").slice(0, 120) || "nota fiscal";
  const transacao = await banco.adicionarTransacao({ tipo: "saida", valor, categoria, descricao, data });
  const onde = d.estabelecimento ? ` em ${d.estabelecimento}` : "";
  const quando = data === hoje ? "" : ` no dia ${data.slice(8, 10)}/${data.slice(5, 7)}`;
  return { texto: `Anotei o gasto de ${real(valor)}${onde}${quando}, na categoria ${categoria}.`, transacao };
}
