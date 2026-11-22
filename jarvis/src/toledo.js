// Consulta (somente leitura) à carteira da Porto e Toledo, pela função "jarvis-leitura" do Supabase.
// Precisa de TOLEDO_URL (endereço da função) e TOLEDO_TOKEN (a mesma senha guardada no Supabase como JARVIS_TOKEN).
// A função não devolve telefone, CPF nem e-mail: só nomes, lotes, datas e valores.

const real = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

export class Toledo {
  constructor(env = process.env, buscar = (...args) => fetch(...args)) {
    this.url = (env.TOLEDO_URL || "").trim();
    this.token = (env.TOLEDO_TOKEN || "").trim();
    // fetch não pode ser chamado como método de outro objeto no Cloudflare ("Illegal invocation"), por isso o padrão é uma função própria.
    this.buscar = buscar;
    this.configurado = Boolean(this.url && this.token);
  }

  async carteira() {
    if (!this.configurado) throw new Error("Sistema Toledo não configurado: faltam TOLEDO_URL e TOLEDO_TOKEN.");
    const resposta = await this.buscar(this.url, {
      headers: { "x-jarvis-token": this.token },
      signal: AbortSignal.timeout(15000),
    });
    if (resposta.status === 401) throw new Error("O sistema Toledo recusou a senha do Jarvis (TOLEDO_TOKEN).");
    if (!resposta.ok) throw new Error(`O sistema Toledo respondeu com erro ${resposta.status}.`);
    return resposta.json();
  }

  // Recorta só o assunto pedido, para a IA não receber mais dados do que precisa.
  async consultar(assunto = "tudo") {
    const d = await this.carteira();
    const corte = (bloco, max = 15) => ({ quantidade: bloco.quantidade, total: bloco.total, itens: bloco.itens.slice(0, max), ...(bloco.itens.length > max ? { aviso: `mostrando ${max} de ${bloco.itens.length}` } : {}) });
    switch (assunto) {
      case "atrasos": return { hoje: d.hoje, emAtraso: corte(d.emAtraso) };
      case "a_receber_mes": return { hoje: d.hoje, aReceberNoMes: corte(d.aReceberNoMes) };
      case "vencendo_7_dias": return { hoje: d.hoje, vencendoEm7Dias: corte(d.vencendoEm7Dias) };
      case "recebido_mes": return { hoje: d.hoje, recebidoNoMes: d.recebidoNoMes };
      case "vendas_lotes": return { hoje: d.hoje, vendasDeLotes: d.vendasDeLotes };
      case "ocupacao": return { hoje: d.hoje, imoveis: d.imoveis };
      default:
        return {
          hoje: d.hoje,
          recebidoNoMes: d.recebidoNoMes,
          emAtraso: corte(d.emAtraso, 8),
          aReceberNoMes: { quantidade: d.aReceberNoMes.quantidade, total: d.aReceberNoMes.total },
          vencendoEm7Dias: corte(d.vencendoEm7Dias, 8),
          vendasDeLotes: d.vendasDeLotes,
          imoveis: d.imoveis,
        };
    }
  }

  // Texto curto para o resumo diário do WhatsApp.
  async textoResumo() {
    const d = await this.carteira();
    const linhas = [];
    if (d.emAtraso.quantidade) {
      linhas.push(`🔴 Em atraso: ${d.emAtraso.quantidade} (${real(d.emAtraso.total)} com encargos)`);
      d.emAtraso.itens.slice(0, 3).forEach((i) => linhas.push(`• ${i.nome} – ${i.imovel}, ${i.dias} dia${i.dias === 1 ? "" : "s"}`));
    } else {
      linhas.push("🟢 Nada em atraso.");
    }
    if (d.vencendoEm7Dias.quantidade) {
      linhas.push(`📅 Vence nos próximos 7 dias: ${d.vencendoEm7Dias.quantidade} (${real(d.vencendoEm7Dias.total)})`);
      d.vencendoEm7Dias.itens.slice(0, 3).forEach((i) => linhas.push(`• ${dataBR(i.vencimento)} – ${i.nome}, ${real(i.valor)}`));
    }
    linhas.push(`💵 Recebido no mês: ${real(d.recebidoNoMes.total)}. A receber ainda neste mês: ${real(d.aReceberNoMes.total)}.`);
    return `🏢 Carteira Toledo:\n${linhas.join("\n")}`;
  }
}
