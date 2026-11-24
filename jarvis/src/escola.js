// Modo Escola: progresso da criança (estrelas, dias seguidos, conquistas), provas marcadas
// e o relatório do dia para o pai ou a mãe no WhatsApp e no Telegram.
import { formatar, hojeLocal, horaLocal, inicioDoDia, lerData } from "./fuso.js";

export const MATERIAS = ["matemática", "português", "inglês", "ciências", "história", "geografia", "artes", "outra"];
const RESULTADOS = { acertou: 2, praticou: 1, errou: 1 }; // estrelas: esforço também conta
const MARCOS_ESTRELAS = [10, 25, 50, 100, 200, 500, 1000];
const MARCOS_DIAS = [3, 7, 15, 30, 60, 100];
const JANELA_HORAS = 4;
const nomeCrianca = () => process.env.JARVIS_NOME_ESTUDANTE || "A estudante";

export function horaDoRelatorioEscola(env = process.env) {
  const valor = (env.JARVIS_RELATORIO_ESCOLA_HORA ?? "19").trim().toLowerCase();
  if (["", "desligado", "nao", "não", "off"].includes(valor)) return null;
  const hora = Number.parseInt(valor, 10);
  return Number.isInteger(hora) && hora >= 0 && hora <= 23 ? hora : 19;
}

const dataCurta = (dia) => formatar(lerData(`${dia}T12:00`), { weekday: "long", day: "2-digit", month: "2-digit" });
const diasEntre = (a, b) => Math.round((lerData(`${b}T12:00`) - lerData(`${a}T12:00`)) / 86400000);

export class Escola {
  constructor(armazem) {
    this.armazem = armazem;
  }

  async #estudos() {
    return (await this.armazem.listar("estudos")).sort((a, b) => a.em.localeCompare(b.em));
  }

  // Dias seguidos com estudo, contando até hoje (ou até ontem, se hoje ainda não estudou).
  static #sequencia(dias, hoje) {
    const set = new Set(dias);
    let dia = set.has(hoje) ? hoje : hojeLocal(inicioDoDia(lerData(`${hoje}T12:00`), -1));
    let n = 0;
    while (set.has(dia)) {
      n++;
      dia = hojeLocal(inicioDoDia(lerData(`${dia}T12:00`), -1));
    }
    return n;
  }

  async progresso(agora = new Date()) {
    const estudos = await this.#estudos();
    const hoje = hojeLocal(agora);
    const deHoje = estudos.filter((e) => e.dia === hoje);
    const conquistas = (await this.armazem.listar("conquistas")).sort((a, b) => a.em.localeCompare(b.em)).map((c) => c.texto);
    return {
      estrelas: estudos.reduce((s, e) => s + e.estrelas, 0),
      estrelasHoje: deHoje.reduce((s, e) => s + e.estrelas, 0),
      diasSeguidos: Escola.#sequencia([...new Set(estudos.map((e) => e.dia))], hoje),
      exerciciosHoje: deHoje.length,
      acertosHoje: deHoje.filter((e) => e.resultado === "acertou").length,
      conquistas: conquistas.slice(-5),
    };
  }

  // O professor chama depois de corrigir cada exercício ou pergunta de quiz.
  async registrarEstudo({ materia, assunto, resultado, observacao = "" }, agora = new Date()) {
    if (!MATERIAS.includes(materia)) materia = "outra";
    if (!(resultado in RESULTADOS)) throw new Error("resultado deve ser acertou, errou ou praticou");
    const antes = await this.progresso(agora);
    const item = {
      id: `${agora.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      em: agora.toISOString(), dia: hojeLocal(agora), materia,
      assunto: String(assunto ?? "").trim().slice(0, 80), resultado,
      observacao: String(observacao ?? "").trim().slice(0, 140), estrelas: RESULTADOS[resultado],
    };
    await this.armazem.salvar("estudos", item.id, item);
    const depois = await this.progresso(agora);

    // Conquistas novas: marcos de estrelas e de dias seguidos.
    const novas = [];
    for (const m of MARCOS_ESTRELAS) if (antes.estrelas < m && depois.estrelas >= m) novas.push(`⭐ ${m} estrelas!`);
    for (const m of MARCOS_DIAS) if (antes.diasSeguidos < m && depois.diasSeguidos >= m) novas.push(`🔥 ${m} dias seguidos estudando!`);
    if (antes.estrelas === 0) novas.unshift("🎉 Primeiro exercício com o Jarvis!");
    for (const texto of novas) await this.armazem.salvar("conquistas", `${item.id}-${novas.indexOf(texto)}`, { texto, em: item.em });
    return { estrelasGanhas: item.estrelas, estrelas: depois.estrelas, diasSeguidos: depois.diasSeguidos, conquistasNovas: novas };
  }

  // ---------- Provas ----------
  async agendarProva({ materia, assunto, data }, agora = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data))) throw new Error("A data da prova precisa estar no formato AAAA-MM-DD.");
    if (data < hojeLocal(agora)) throw new Error("Essa data já passou.");
    if (!MATERIAS.includes(materia)) materia = "outra";
    const prova = { id: `${data}-${materia}`.replace(/[^\w-]/g, ""), materia, assunto: String(assunto ?? "").trim().slice(0, 80), data };
    await this.armazem.salvar("provas", prova.id, prova);
    return { prova, faltamDias: diasEntre(hojeLocal(agora), data) };
  }

  async removerProva({ materia, data }) {
    const provas = await this.armazem.listar("provas");
    const alvo = provas.filter((p) => (!materia || p.materia === materia) && (!data || p.data === data));
    for (const p of alvo) await this.armazem.apagar("provas", p.id);
    return { removidas: alvo.length };
  }

  async provasProximas(agora = new Date(), dias = 14) {
    const hoje = hojeLocal(agora);
    return (await this.armazem.listar("provas"))
      .filter((p) => p.data >= hoje && diasEntre(hoje, p.data) <= dias)
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((p) => ({ ...p, faltamDias: diasEntre(hoje, p.data) }));
  }

  // Linha de contexto para o professor (vai junto com cada mensagem da criança).
  async contexto(agora = new Date()) {
    const provas = await this.provasProximas(agora, 10);
    if (!provas.length) return "";
    const quando = (n) => (n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n} dias`);
    return `[Provas marcadas: ${provas.map((p) => `${p.materia}${p.assunto ? ` (${p.assunto})` : ""} ${quando(p.faltamDias)}, ${dataCurta(p.data)}`).join("; ")}]`;
  }

  // ---------- Relatório do dia para o pai/mãe ----------
  async textoRelatorio(agora = new Date()) {
    const hoje = hojeLocal(agora);
    const deHoje = (await this.#estudos()).filter((e) => e.dia === hoje);
    if (!deHoje.length) return null;
    const p = await this.progresso(agora);
    const porMateria = new Map();
    for (const e of deHoje) {
      const assuntos = porMateria.get(e.materia) || new Set();
      if (e.assunto) assuntos.add(e.assunto);
      porMateria.set(e.materia, assuntos);
    }
    const estudou = [...porMateria].map(([m, a]) => (a.size ? `${m} (${[...a].slice(0, 3).join(", ")})` : m)).join("; ");
    const reforcar = [...new Set(deHoje.filter((e) => e.resultado === "errou").map((e) => e.assunto || e.materia))].slice(0, 3);
    const notas = deHoje.map((e) => e.observacao).filter(Boolean).slice(-2);
    const linhas = [
      `📚 ${nomeCrianca()} estudou com o Jarvis hoje (${dataCurta(hoje)}):`,
      `• Matérias: ${estudou}`,
      `• Exercícios: ${deHoje.length} (${p.acertosHoje} acerto${p.acertosHoje === 1 ? "" : "s"} de primeira)`,
    ];
    if (reforcar.length) linhas.push(`• Para reforçar: ${reforcar.join(", ")}`);
    if (notas.length) linhas.push(`• Observações do professor: ${notas.join(" / ")}`);
    linhas.push(`• ⭐ ${p.estrelasHoje} estrelas hoje · ${p.estrelas} no total · 🔥 ${p.diasSeguidos} dia${p.diasSeguidos === 1 ? "" : "s"} seguido${p.diasSeguidos === 1 ? "" : "s"}`);
    const provas = await this.provasProximas(agora, 7);
    for (const pr of provas) linhas.push(`• 📅 Prova de ${pr.materia}${pr.assunto ? ` (${pr.assunto})` : ""} ${pr.faltamDias === 0 ? "hoje" : pr.faltamDias === 1 ? "amanhã" : `em ${pr.faltamDias} dias`}`);
    return linhas.join("\n");
  }

  // Chamado de minuto em minuto: manda o relatório uma vez por dia, na hora marcada, se ela estudou.
  async enviarRelatorio(canais, agora = new Date(), hora = horaDoRelatorioEscola()) {
    if (hora === null) return { enviados: 0 };
    const h = horaLocal(agora);
    if (h < hora || h >= hora + JANELA_HORAS) return { enviados: 0 };
    const hoje = hojeLocal(agora);
    let enviados = 0;
    let texto;
    for (const canal of canais) {
      if (!canal?.configurado) continue;
      const colecao = canal.nome === "telegram" ? "relatorio-escola-telegram" : "relatorio-escola";
      if (await this.armazem.obter(colecao, hoje)) continue;
      texto ??= await this.textoRelatorio(agora);
      if (!texto) return { enviados: 0 }; // não estudou hoje: sem relatório
      try {
        await canal.enviar(texto);
        await this.armazem.salvar(colecao, hoje, { em: agora.toISOString() });
        enviados++;
      } catch (erro) {
        console.error("Relatório da escola:", erro.message);
      }
    }
    return { enviados };
  }
}
