// Interface do Jarvis: voz (ouvir e falar), conversa e painéis.
const $ = (id) => document.getElementById(id);
const el = {
  conversa: $("conversa"), texto: $("texto"), form: $("formulario"), estado: $("estado"),
  reator: $("reator"), escuta: $("escutaContinua"), voz: $("vozLigada"), nova: $("novaConversa"),
};

const PALAVRA_CHAVE = /\bjarvis\b[,.!?\s]*/i;
const moeda = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------- Preferências guardadas no navegador ----------
const guardar = {
  ler(chave, padrao) { try { return localStorage.getItem(chave) ?? padrao; } catch { return padrao; } },
  escrever(chave, valor) { try { localStorage.setItem(chave, valor); } catch {} },
};
let conversaId = guardar.ler("jarvis.conversa", null) || novoId();
guardar.escrever("jarvis.conversa", conversaId);
let senha = guardar.ler("jarvis.senha", "");
el.voz.checked = guardar.ler("jarvis.voz", "1") === "1";

function novoId() { return (crypto.randomUUID?.() || String(Math.random()).slice(2)); }

// ---------- Estado visual ----------
function definirEstado(estado, texto) {
  document.body.classList.remove("ouvindo", "pensando", "falando");
  if (estado) document.body.classList.add(estado);
  el.estado.textContent = texto ?? {
    ouvindo: "Ouvindo...", pensando: "Processando...", falando: "Falando...",
  }[estado] ?? (el.escuta.checked ? 'Diga "Jarvis" para chamar' : "Toque no círculo e fale");
}

function adicionarMensagem(texto, tipo) {
  const div = document.createElement("div");
  div.className = `msg ${tipo}`;
  div.textContent = texto;
  el.conversa.appendChild(div);
  el.conversa.scrollTop = el.conversa.scrollHeight;
}

// ---------- Comunicação com o servidor ----------
async function api(caminho, opcoes = {}) {
  const resp = await fetch(caminho, {
    ...opcoes,
    headers: { "Content-Type": "application/json", "x-jarvis-senha": senha, ...(opcoes.headers || {}) },
  });
  if (resp.status === 401) {
    const nova = prompt("Senha do Jarvis:");
    if (nova === null) throw new Error("Senha necessária.");
    senha = nova;
    guardar.escrever("jarvis.senha", senha);
    return api(caminho, opcoes);
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || `Erro ${resp.status}`);
  return dados;
}

let ocupado = false;
async function enviar(texto) {
  texto = texto.trim();
  if (!texto || ocupado) return;
  ocupado = true;
  pararDeOuvir();
  falando.cancelar();
  adicionarMensagem(texto, "usuario");
  definirEstado("pensando");
  try {
    const { texto: resposta, acoes } = await api("/api/conversar", {
      method: "POST",
      body: JSON.stringify({ conversa: conversaId, texto }),
    });
    adicionarMensagem(resposta, "jarvis");
    if (acoes?.length) atualizarPaineis();
    await falando.falar(resposta);
  } catch (erro) {
    adicionarMensagem(erro.message, "jarvis erro");
    await falando.falar(erro.message);
  } finally {
    ocupado = false;
    definirEstado(null);
    if (el.escuta.checked) comecarAOuvir();
  }
}

// ---------- Fala (texto para voz) ----------
const falando = {
  voz: null,
  escolherVoz() {
    const vozes = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("pt"));
    this.voz = vozes.find((v) => /pt-br/i.test(v.lang) && /google|natural|online/i.test(v.name))
      || vozes.find((v) => /pt-br/i.test(v.lang)) || vozes[0] || null;
  },
  falar(texto) {
    if (!el.voz.checked || !("speechSynthesis" in window) || !texto) return Promise.resolve();
    return new Promise((resolve) => {
      const fala = new SpeechSynthesisUtterance(texto);
      fala.lang = "pt-BR";
      if (this.voz) fala.voice = this.voz;
      fala.rate = 1.05;
      fala.onend = fala.onerror = () => resolve();
      definirEstado("falando");
      speechSynthesis.speak(fala);
    });
  },
  cancelar() { if ("speechSynthesis" in window) speechSynthesis.cancel(); },
};
if ("speechSynthesis" in window) {
  falando.escolherVoz();
  speechSynthesis.onvoiceschanged = () => falando.escolherVoz();
}

// ---------- Escuta (voz para texto) ----------
const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
let reconhecimento = null;
let ouvindo = false;
let esperandoComando = false; // ouviu "Jarvis" sozinho e aguarda o pedido

function criarReconhecimento() {
  const r = new Reconhecimento();
  r.lang = "pt-BR";
  r.interimResults = true;
  r.continuous = el.escuta.checked;

  r.onresult = (evento) => {
    let final = "", parcial = "";
    for (let i = evento.resultIndex; i < evento.results.length; i++) {
      const t = evento.results[i][0].transcript;
      if (evento.results[i].isFinal) final += t; else parcial += t;
    }
    if (parcial) el.texto.value = parcial;
    if (!final) return;
    el.texto.value = "";

    if (!el.escuta.checked || esperandoComando) {
      esperandoComando = false;
      enviar(final.replace(PALAVRA_CHAVE, ""));
      return;
    }
    // Escuta contínua: só responde quando ouvir "Jarvis".
    const pos = final.search(PALAVRA_CHAVE);
    if (pos === -1) return;
    const pedido = final.slice(pos).replace(PALAVRA_CHAVE, "").trim();
    if (pedido) enviar(pedido);
    else { esperandoComando = true; definirEstado("ouvindo", "Pois não?"); bip(); }
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      el.escuta.checked = false;
      adicionarMensagem("Permita o uso do microfone no navegador para falar com o Jarvis.", "aviso");
    }
  };
  r.onend = () => {
    ouvindo = false;
    if (!ocupado) definirEstado(null);
    // No modo contínuo, o navegador encerra sozinho de tempos em tempos: reinicia.
    if (el.escuta.checked && !ocupado) setTimeout(comecarAOuvir, 300);
  };
  return r;
}

function comecarAOuvir() {
  if (!Reconhecimento) {
    adicionarMensagem("Seu navegador não reconhece voz. Use o Chrome ou o Edge (no celular, o Chrome no Android). Você ainda pode digitar.", "aviso");
    el.escuta.checked = false;
    return;
  }
  if (ouvindo || ocupado) return;
  falando.cancelar();
  reconhecimento = criarReconhecimento();
  try {
    reconhecimento.start();
    ouvindo = true;
    definirEstado("ouvindo", el.escuta.checked && !esperandoComando ? 'Diga "Jarvis"...' : "Ouvindo...");
  } catch { /* já estava ouvindo */ }
}

function pararDeOuvir() {
  if (reconhecimento && ouvindo) { reconhecimento.onend = () => { ouvindo = false; }; reconhecimento.abort(); }
  ouvindo = false;
}

function bip() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.12);
  } catch {}
}

// ---------- Painéis ----------
function preencherLista(ul, itens, render, vazio) {
  ul.replaceChildren();
  if (!itens.length) {
    const li = document.createElement("li"); li.className = "vazio"; li.textContent = vazio; ul.appendChild(li); return;
  }
  for (const item of itens) ul.appendChild(render(item));
}
function li(texto, detalhe) {
  const item = document.createElement("li");
  item.textContent = texto;
  if (detalhe) { const s = document.createElement("small"); s.textContent = detalhe; item.appendChild(s); }
  return item;
}
const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function atualizarPaineis() {
  try {
    const p = await api("/api/painel");
    preencherLista($("listaLembretes"), p.lembretes, (l) => li(l.texto, dataHora(l.quando)), 'Nenhum lembrete. Ex.: "me lembre de pagar a conta amanhã às 9h".');
    preencherLista($("listaNotas"), p.notas, (n) => li(n.texto, dataHora(n.criadaEm)), 'Nenhuma nota. Ex.: "anota que a senha do wi-fi é..."');
    preencherLista($("listaTransacoes"), p.transacoes, (t) => {
      const item = document.createElement("li");
      item.className = "transacao";
      const desc = document.createElement("span");
      desc.textContent = t.descricao || t.categoria;
      const v = document.createElement("span");
      v.className = `valor ${t.tipo}`;
      v.textContent = (t.tipo === "saida" ? "- " : "+ ") + moeda(t.valor);
      const s = document.createElement("small");
      s.textContent = `${t.categoria} · ${t.data.split("-").reverse().join("/")}`;
      item.append(desc, v, s);
      return item;
    }, 'Nada registrado. Ex.: "gastei 35 reais no almoço".');

    const f = p.financas;
    $("kEntradas").textContent = moeda(f.entradas);
    $("kSaidas").textContent = moeda(f.saidas);
    $("kSaldo").textContent = moeda(f.saldo);
    $("kSaldo").style.color = f.saldo < 0 ? "var(--vermelho)" : "var(--verde)";
    const cats = Object.entries(f.gastosPorCategoria).sort((a, b) => b[1] - a[1]);
    const maior = cats[0]?.[1] || 1;
    const caixa = $("categorias");
    caixa.replaceChildren();
    for (const [nome, valor] of cats) {
      const c = document.createElement("div");
      c.className = "categoria";
      const linha = document.createElement("div");
      const n = document.createElement("span"); n.textContent = nome;
      const v = document.createElement("span"); v.textContent = moeda(valor);
      linha.append(n, v);
      const barra = document.createElement("div"); barra.className = "barra";
      const i = document.createElement("i"); i.style.width = `${(valor / maior) * 100}%`;
      barra.appendChild(i);
      c.append(linha, barra);
      caixa.appendChild(c);
    }
  } catch (erro) {
    console.warn("Painéis:", erro.message);
  }
}

// ---------- Lembretes na hora certa ----------
async function verificarLembretes() {
  try {
    const vencidos = await api("/api/lembretes/vencidos");
    for (const l of vencidos) {
      const aviso = `Lembrete: ${l.texto}`;
      adicionarMensagem(aviso, "aviso");
      if ("Notification" in window && Notification.permission === "granted") new Notification("Jarvis", { body: l.texto });
      bip();
      if (!ocupado) await falando.falar(aviso).then(() => definirEstado(null));
    }
    if (vencidos.length) atualizarPaineis();
  } catch {}
}

// ---------- Eventos ----------
el.form.addEventListener("submit", (e) => { e.preventDefault(); const t = el.texto.value; el.texto.value = ""; enviar(t); });
el.reator.addEventListener("click", () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  if (ouvindo && !el.escuta.checked) { pararDeOuvir(); definirEstado(null); return; }
  esperandoComando = el.escuta.checked; // no modo contínuo, tocar no círculo = já é um chamado
  if (ouvindo) { definirEstado("ouvindo", "Pois não?"); return; }
  comecarAOuvir();
});
el.escuta.addEventListener("change", () => {
  pararDeOuvir();
  esperandoComando = false;
  if (el.escuta.checked) comecarAOuvir(); else definirEstado(null);
});
el.voz.addEventListener("change", () => { guardar.escrever("jarvis.voz", el.voz.checked ? "1" : "0"); if (!el.voz.checked) falando.cancelar(); });
el.nova.addEventListener("click", async () => {
  await api("/api/conversa/limpar", { method: "POST", body: JSON.stringify({ conversa: conversaId }) }).catch(() => {});
  conversaId = novoId();
  guardar.escrever("jarvis.conversa", conversaId);
  el.conversa.replaceChildren();
  adicionarMensagem("Nova conversa iniciada. Como posso ajudar?", "jarvis");
});

setInterval(() => {
  $("relogio").textContent = new Date().toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}, 1000);
setInterval(verificarLembretes, 15000);

// ---------- Início ----------
const hora = new Date().getHours();
const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
adicionarMensagem(`${saudacao}! Sou o Jarvis. Posso pesquisar na internet, anotar coisas, criar lembretes e cuidar das suas finanças. É só falar.`, "jarvis");
definirEstado(null);
atualizarPaineis();
verificarLembretes();
