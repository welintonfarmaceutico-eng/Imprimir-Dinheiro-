// Contatos do Jarvis (só do adulto): "liga para a Maria", "manda mensagem pro meu irmão".
// Ficam no banco do próprio Jarvis. O Modo Escola não tem acesso (o servidor bloqueia), e a IA só
// recebe os contatos que procurou, nunca a lista inteira de uma vez.
const MAX_IMPORTAR = 3000;
const MAX_BUSCA = 5;

// Tira acentos e símbolos para comparar nomes ("Mãe" = "mae", "João" = "joao").
export const simplificar = (s) =>
  String(s ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Telefone só com dígitos (e "+" no começo, se tiver).
export function limparTelefone(t) {
  const s = String(t ?? "").trim();
  const digitos = s.replace(/\D/g, "");
  if (digitos.length < 3 || digitos.length > 15) return "";
  return s.startsWith("+") ? `+${digitos}` : digitos;
}

const idDe = (nome) => simplificar(nome).replace(/ /g, "-").slice(0, 60) || "sem-nome";

export class Contatos {
  constructor(armazem) {
    this.armazem = armazem;
  }

  async #todos() {
    return this.armazem.listar("contatos");
  }

  async quantidade() {
    return (await this.#todos()).length;
  }

  // Cria ou atualiza um contato (junta telefones novos e apelidos ao que já existia).
  async salvar({ nome, telefone = "", apelido = "" }) {
    nome = String(nome ?? "").trim().slice(0, 80);
    if (!simplificar(nome)) throw new Error("Diga o nome do contato.");
    const id = idDe(nome);
    const atual = (await this.armazem.obter("contatos", id)) || { id, nome, telefones: [], apelidos: [] };
    const tel = limparTelefone(telefone);
    if (telefone && !tel) throw new Error("Esse telefone não parece válido.");
    if (tel && !atual.telefones.includes(tel)) atual.telefones.push(tel);
    const ap = String(apelido ?? "").trim().slice(0, 40);
    if (ap && !atual.apelidos.some((a) => simplificar(a) === simplificar(ap))) atual.apelidos.push(ap);
    atual.nome = nome;
    await this.armazem.salvar("contatos", id, atual);
    return atual;
  }

  async apagar(nome) {
    const achados = await this.buscar(nome);
    const exato = achados.find((c) => simplificar(c.nome) === simplificar(nome));
    if (!exato) return { apagado: false, parecidos: achados.map((c) => c.nome) };
    await this.armazem.apagar("contatos", idDe(exato.nome));
    return { apagado: true, nome: exato.nome };
  }

  // Procura por nome ou apelido: exato primeiro, depois começo de palavra, depois parte do nome.
  async buscar(termo) {
    const t = simplificar(termo);
    if (!t) return [];
    const pontos = (c) => {
      const nomes = [c.nome, ...(c.apelidos || [])].map(simplificar);
      if (nomes.some((n) => n === t)) return 3;
      if (nomes.some((n) => n.split(" ").some((p) => p.startsWith(t)) || n.startsWith(t))) return 2;
      if (nomes.some((n) => n.includes(t))) return 1;
      return 0;
    };
    return (await this.#todos())
      .map((c) => ({ c, p: pontos(c) }))
      .filter((x) => x.p > 0)
      .sort((a, b) => b.p - a.p || a.c.nome.localeCompare(b.c.nome))
      .slice(0, MAX_BUSCA)
      .map((x) => ({ nome: x.c.nome, telefones: x.c.telefones, apelidos: x.c.apelidos }));
  }

  // Contatos escolhidos no seletor do celular: [{ nome, telefones: [...] }].
  async importar(lista) {
    if (!Array.isArray(lista)) throw new Error("Lista de contatos inválida.");
    let importados = 0;
    for (const item of lista.slice(0, MAX_IMPORTAR)) {
      const nome = String(item?.nome ?? "").trim();
      const telefones = (Array.isArray(item?.telefones) ? item.telefones : []).map(limparTelefone).filter(Boolean);
      if (!simplificar(nome) || !telefones.length) continue;
      const id = idDe(nome);
      const atual = (await this.armazem.obter("contatos", id)) || { id, nome, telefones: [], apelidos: [] };
      for (const t of telefones) if (!atual.telefones.includes(t)) atual.telefones.push(t);
      await this.armazem.salvar("contatos", id, atual);
      importados++;
    }
    return { importados, total: await this.quantidade() };
  }

  async apagarTodos() {
    const todos = await this.#todos();
    for (const c of todos) await this.armazem.apagar("contatos", c.id);
    return { apagados: todos.length };
  }
}
