// Onde os dados ficam guardados. Cada item é um registro separado, por coleção.
//  - ArmazemArquivo: arquivo JSON no disco (rodando no seu computador)
//  - ArmazemBlobs:   Netlify Blobs (rodando no Netlify)
import fs from "node:fs";
import path from "node:path";

export class ArmazemArquivo {
  constructor(arquivo) {
    this.arquivo = arquivo;
    this.dados = fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, "utf8")) : {};
  }

  #gravar() {
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.dados, null, 2));
    fs.renameSync(tmp, this.arquivo); // escrita atômica
  }

  async listar(colecao) {
    return Object.values(this.dados[colecao] || {});
  }
  async obter(colecao, id) {
    return this.dados[colecao]?.[id] ?? null;
  }
  async salvar(colecao, id, valor) {
    (this.dados[colecao] ||= {})[id] = valor;
    this.#gravar();
  }
  async apagar(colecao, id) {
    if (!this.dados[colecao]?.[id]) return false;
    delete this.dados[colecao][id];
    this.#gravar();
    return true;
  }
}

export class ArmazemBlobs {
  constructor(getStore, nome = "jarvis") {
    this.getStore = getStore;
    this.nome = nome;
  }
  // Abre a "gaveta" a cada uso: o Netlify reaproveita o servidor entre pedidos, e o passe
  // de acesso de um pedido antigo vence ("Token expired"). Cada uso pega o passe atual.
  get store() {
    return this.getStore({ name: this.nome, consistency: "strong" });
  }
  async listar(colecao) {
    const { blobs } = await this.store.list({ prefix: `${colecao}/` });
    const itens = await Promise.all(blobs.map((b) => this.store.get(b.key, { type: "json" })));
    return itens.filter(Boolean);
  }
  async obter(colecao, id) {
    return this.store.get(`${colecao}/${id}`, { type: "json" });
  }
  async salvar(colecao, id, valor) {
    await this.store.setJSON(`${colecao}/${id}`, valor);
  }
  async apagar(colecao, id) {
    const existe = await this.obter(colecao, id);
    if (!existe) return false;
    await this.store.delete(`${colecao}/${id}`);
    return true;
  }
}

// Cloudflare D1 (banco SQL grátis do Cloudflare). Uma tabela só, no mesmo formato chave/valor.
export class ArmazemD1 {
  constructor(db) {
    this.db = db;
    this.pronto = null;
  }
  #preparar() {
    this.pronto ||= this.db
      .prepare("CREATE TABLE IF NOT EXISTS itens (colecao TEXT NOT NULL, id TEXT NOT NULL, valor TEXT NOT NULL, PRIMARY KEY (colecao, id))")
      .run()
      .catch((erro) => {
        this.pronto = null; // tenta de novo no próximo uso
        throw erro;
      });
    return this.pronto;
  }
  async listar(colecao) {
    await this.#preparar();
    const { results } = await this.db.prepare("SELECT valor FROM itens WHERE colecao = ?").bind(colecao).all();
    return results.map((r) => JSON.parse(r.valor));
  }
  async obter(colecao, id) {
    await this.#preparar();
    const r = await this.db.prepare("SELECT valor FROM itens WHERE colecao = ? AND id = ?").bind(colecao, String(id)).first();
    return r ? JSON.parse(r.valor) : null;
  }
  async salvar(colecao, id, valor) {
    await this.#preparar();
    await this.db
      .prepare("INSERT INTO itens (colecao, id, valor) VALUES (?, ?, ?) ON CONFLICT (colecao, id) DO UPDATE SET valor = excluded.valor")
      .bind(colecao, String(id), JSON.stringify(valor))
      .run();
  }
  async apagar(colecao, id) {
    await this.#preparar();
    const r = await this.db.prepare("DELETE FROM itens WHERE colecao = ? AND id = ?").bind(colecao, String(id)).run();
    return r.meta.changes > 0;
  }
}
