// Interface do Jarvis: voz (ouvir e falar), conversa em tempo real, painéis, temas e cadastro rápido.
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
function novoId() { return (crypto.randomUUID?.() || String(Math.random()).slice(2)); }
function hojeLocal() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

// Uma conversa nova por dia: conversas curtas custam bem menos (o histórico é relido a cada mensagem).
let conversaId = guardar.ler("jarvis.conversa", null);
if (!conversaId || guardar.ler("jarvis.conversa.dia", "") !== hojeLocal()) {
  conversaId = novoId();
  guardar.escrever("jarvis.conversa", conversaId);
  guardar.escrever("jarvis.conversa.dia", hojeLocal());
}
let senha = guardar.ler("jarvis.senha", "");
el.voz.checked = guardar.ler("jarvis.voz", "1") === "1";

// ---------- Estado visual ----------
function definirEstado(estado, texto) {
  document.body.classList.remove("ouvindo", "pensando", "falando");
  if (estado) document.body.classList.add(estado);
  el.estado.textContent = texto ?? {
    ouvindo: "Ouvindo...", pensando: "Processando...", falando: "Falando...",
  }[estado] ?? (el.escuta.checked ? 'Diga "Jarvis" para chamar' : "Toque no círculo e fale");
}

// O círculo dá um "pulo" a cada palavra falada ou ouvida e volta devagar.
let pulsoTimer = null;
function pulsar(forca = 1.18) {
  el.reator.style.setProperty("--pulso", String(forca));
  clearTimeout(pulsoTimer);
  pulsoTimer = setTimeout(() => el.reator.style.setProperty("--pulso", "1"), 140);
}

function adicionarMensagem(texto, tipo) {
  const div = document.createElement("div");
  div.className = `msg ${tipo}`;
  div.textContent = texto;
  el.conversa.appendChild(div);
  el.conversa.scrollTop = el.conversa.scrollHeight;
  return div;
}

// ---------- Comunicação com o servidor ----------
async function tratarNaoAutorizado(dados, repetir) {
  // 401 sem a nossa mensagem = bloqueio do login do Netlify (sessão expirada).
  if (dados.erro !== "Senha incorreta") {
    throw new Error("Seu login expirou. Recarregue a página e entre de novo na sua conta do Netlify.");
  }
  const nova = prompt("Senha do Jarvis:");
  if (nova === null) throw new Error("Senha necessária.");
  senha = nova;
  guardar.escrever("jarvis.senha", senha);
  return repetir();
}

async function api(caminho, opcoes = {}) {
  const resp = await fetch(caminho, {
    ...opcoes,
    headers: { "Content-Type": "application/json", "x-jarvis-senha": senha, ...(opcoes.headers || {}) },
  });
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 401) return tratarNaoAutorizado(dados, () => api(caminho, opcoes));
  if (!resp.ok) throw new Error(dados.erro || `Erro ${resp.status}`);
  return dados;
}

// Conversa em tempo real: lê os eventos que o servidor manda enquanto a resposta é gerada.
async function conversarAoVivo(corpo, aoEvento) {
  const resp = await fetch("/api/conversar/ao-vivo", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jarvis-senha": senha },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok || !resp.body) {
    const dados = await resp.json().catch(() => ({}));
    if (resp.status === 401) return tratarNaoAutorizado(dados, () => conversarAoVivo(corpo, aoEvento));
    throw new Error(dados.erro || `Erro ${resp.status}`);
  }
  const leitor = resp.body.getReader();
  const decodificador = new TextDecoder();
  let resto = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    resto += decodificador.decode(value, { stream: true });
    let fim;
    while ((fim = resto.indexOf("\n\n")) !== -1) {
      const bloco = resto.slice(0, fim);
      resto = resto.slice(fim + 2);
      if (bloco.startsWith("data: ")) aoEvento(JSON.parse(bloco.slice(6)));
    }
  }
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

  let bolha = null;
  let escrito = "";
  let paraFalar = ""; // texto ainda não falado (fala frase por frase, sem esperar o fim)
  const falarFrasesProntas = (final = false) => {
    let corte;
    // Uma frase termina em . ! ? … ou quebra de linha seguida de espaço (não corta "R$ 1.500,00").
    while ((corte = paraFalar.search(/[.!?…:](\s)|\n/)) !== -1) {
      const frase = paraFalar.slice(0, corte + 1);
      paraFalar = paraFalar.slice(corte + 1);
      falando.enfileirar(frase);
    }
    if (final && paraFalar.trim()) { falando.enfileirar(paraFalar); paraFalar = ""; }
  };

  try {
    await conversarAoVivo({ conversa: conversaId, texto }, (evento) => {
      if (evento.tipo === "texto") {
        if (!bolha) { bolha = adicionarMensagem("", "jarvis digitando"); definirEstado("falando", "Respondendo..."); }
        escrito += evento.delta;
        paraFalar += evento.delta;
        bolha.textContent = escrito;
        el.conversa.scrollTop = el.conversa.scrollHeight;
        falarFrasesProntas();
      } else if (evento.tipo === "fim") {
        if (!escrito.trim()) { bolha = adicionarMensagem(evento.texto, "jarvis"); paraFalar = evento.texto; }
        falarFrasesProntas(true);
        if (evento.acoes?.length) atualizarPaineis();
        if (evento.acoes?.some((a) => a.startsWith("agenda_"))) atualizarAgenda();
      } else if (evento.tipo === "erro") {
        falarFrasesProntas(true);
        adicionarMensagem(evento.mensagem, "jarvis erro");
        falando.enfileirar(evento.mensagem);
      }
    });
  } catch (erro) {
    adicionarMensagem(erro.message, "jarvis erro");
    falando.enfileirar(erro.message);
  } finally {
    bolha?.classList.remove("digitando");
    await falando.terminar();
    ocupado = false;
    definirEstado(null);
    if (el.escuta.checked) {
      // Conversa aberta: dá para responder de volta sem dizer "Jarvis" de novo.
      conversaAbertaAte = Date.now() + JANELA_CONVERSA_MS;
      setTimeout(() => { if (ouvindo && !ocupado && !esperandoComando && !conversaAberta()) definirEstado("ouvindo", 'Diga "Jarvis"...'); }, JANELA_CONVERSA_MS + 100);
      comecarAOuvir();
    }
  }
}

// ---------- Fala (texto para voz) ----------
const falando = {
  voz: null,
  velocidade: Number(guardar.ler("jarvis.velocidade", "1.05")) || 1.05,
  pendentes: 0,
  aoTerminar: [],
  vozesPt() {
    return ("speechSynthesis" in window ? speechSynthesis.getVoices() : []).filter((v) => v.lang?.toLowerCase().startsWith("pt"));
  },
  escolherVoz() {
    const vozes = this.vozesPt();
    const salva = guardar.ler("jarvis.vozNome", "");
    this.voz = vozes.find((v) => v.name === salva)
      || vozes.find((v) => /pt-br/i.test(v.lang) && /google|natural|online/i.test(v.name))
      || vozes.find((v) => /pt-br/i.test(v.lang)) || vozes[0] || null;
  },
  // Põe uma frase na fila de fala (o navegador fala uma depois da outra).
  enfileirar(texto) {
    if (!el.voz.checked || !("speechSynthesis" in window) || !texto?.trim()) return;
    const fala = new SpeechSynthesisUtterance(texto.trim());
    fala.lang = "pt-BR";
    if (this.voz) fala.voice = this.voz;
    fala.rate = this.velocidade;
    fala.onstart = () => definirEstado("falando");
    fala.onboundary = () => pulsar(1.2);
    fala.onend = fala.onerror = () => {
      this.pendentes = Math.max(0, this.pendentes - 1);
      if (!this.pendentes) this.aoTerminar.splice(0).forEach((f) => f());
    };
    this.pendentes++;
    speechSynthesis.speak(fala);
  },
  // Promessa que termina quando tudo o que está na fila foi falado.
  terminar() {
    if (!this.pendentes) return Promise.resolve();
    return new Promise((resolve) => this.aoTerminar.push(resolve));
  },
  falar(texto) { this.enfileirar(texto); return this.terminar(); },
  cancelar() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.pendentes = 0;
    this.aoTerminar.splice(0).forEach((f) => f());
  },
};
if ("speechSynthesis" in window) {
  falando.escolherVoz();
  speechSynthesis.onvoiceschanged = () => { falando.escolherVoz(); preencherVozes(); };
}

// ---------- Escuta (voz para texto) ----------
const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
const JANELA_CONVERSA_MS = 10000; // depois de responder, ouve sem precisar do "Jarvis" por 10 s
const PAUSA_MS = 1500;            // 1,5 s sem falar = frase terminada
let reconhecimento = null;
let ouvindo = false;
let esperandoComando = false;     // ouviu "Jarvis" sozinho e aguarda o pedido
let conversaAbertaAte = 0;
let parcialPendente = "";         // o que já foi ouvido mas o navegador ainda não deu como final
let pausaTimer = null;
let paradoPorPausa = false;

const conversaAberta = () => Date.now() < conversaAbertaAte;

function processarFrase(frase) {
  frase = frase.trim();
  el.texto.value = "";
  if (!frase) return;
  // Sem escuta contínua, logo depois de "Jarvis", ou com a conversa aberta: não precisa da palavra-chave.
  if (!el.escuta.checked || esperandoComando || conversaAberta()) {
    esperandoComando = false;
    conversaAbertaAte = 0;
    enviar(frase.replace(PALAVRA_CHAVE, ""));
    return;
  }
  // Escuta contínua: só responde quando ouvir "Jarvis".
  const pos = frase.search(PALAVRA_CHAVE);
  if (pos === -1) return;
  const pedido = frase.slice(pos).replace(PALAVRA_CHAVE, "").trim();
  if (pedido) enviar(pedido);
  else { esperandoComando = true; definirEstado("ouvindo", "Pois não?"); bip(); }
}

function criarReconhecimento() {
  const r = new Reconhecimento();
  r.lang = "pt-BR";
  r.interimResults = true;
  r.continuous = el.escuta.checked;

  r.onresult = (evento) => {
    pulsar(1.15); // o círculo reage enquanto você fala
    let final = "", parcial = "";
    for (let i = evento.resultIndex; i < evento.results.length; i++) {
      const t = evento.results[i][0].transcript;
      if (evento.results[i].isFinal) final += t; else parcial += t;
    }
    clearTimeout(pausaTimer);
    if (final) {
      parcialPendente = "";
      processarFrase(final);
      return;
    }
    if (parcial) {
      el.texto.value = parcial;
      parcialPendente = parcial;
      // Alguns celulares demoram (ou nunca) para dar a frase como terminada: a pausa resolve.
      pausaTimer = setTimeout(() => {
        if (!parcialPendente) return;
        paradoPorPausa = true;
        try { r.stop(); } catch {}
      }, PAUSA_MS);
    }
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      el.escuta.checked = false;
      adicionarMensagem("Permita o uso do microfone no navegador para falar com o Jarvis.", "aviso");
    }
  };
  r.onend = () => {
    clearTimeout(pausaTimer);
    ouvindo = false;
    // Parou pela pausa e o navegador não entregou a frase final: usa o que já tinha ouvido.
    if (paradoPorPausa && parcialPendente) {
      const frase = parcialPendente;
      parcialPendente = "";
      processarFrase(frase);
    }
    paradoPorPausa = false;
    parcialPendente = "";
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
    const aviso = !el.escuta.checked || esperandoComando ? "Ouvindo..." : conversaAberta() ? "Pode continuar..." : 'Diga "Jarvis"...';
    definirEstado("ouvindo", aviso);
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

// ---------- Cadastro rápido (sem IA, custo zero) ----------
const CATEGORIAS = ["alimentação", "transporte", "moradia", "saúde", "lazer", "educação", "compras", "contas", "salário", "vendas", "outros"];
const rapido = {
  dialogo: $("dialogoRapido"), form: $("formRapido"), campos: $("camposRapido"),
  titulo: $("tituloRapido"), erro: $("erroRapido"), salvar: $("salvarRapido"), tipo: null,
};

function campo(rotulo, elemento) {
  const label = document.createElement("label");
  const span = document.createElement("span"); span.textContent = rotulo;
  label.append(span, elemento);
  return label;
}
function criar(tag, props = {}) { return Object.assign(document.createElement(tag), props); }

function abrirRapido(tipo) {
  rapido.tipo = tipo;
  rapido.erro.textContent = "";
  rapido.campos.replaceChildren();
  if (tipo === "transacao") {
    rapido.titulo.textContent = "Gasto ou ganho";
    const segmentos = criar("div", { className: "segmentos" });
    for (const [valor, nome] of [["saida", "Gasto"], ["entrada", "Ganho"]]) {
      const id = `tipo-${valor}`;
      segmentos.append(criar("input", { type: "radio", name: "tipo", id, value: valor, checked: valor === "saida" }), criar("label", { htmlFor: id, textContent: nome }));
    }
    const lista = criar("datalist", { id: "listaCategorias" });
    CATEGORIAS.forEach((c) => lista.append(criar("option", { value: c })));
    const categoria = criar("input", { name: "categoria", placeholder: "alimentação", required: true });
    categoria.setAttribute("list", "listaCategorias");
    rapido.campos.append(
      segmentos,
      campo("Valor (R$)", criar("input", { name: "valor", inputMode: "decimal", placeholder: "35,90", required: true, autocomplete: "off" })),
      campo("Categoria", categoria), lista,
      campo("Descrição (opcional)", criar("input", { name: "descricao", placeholder: "almoço", autocomplete: "off" })),
    );
  } else if (tipo === "nota") {
    rapido.titulo.textContent = "Nova nota";
    rapido.campos.append(campo("Nota", criar("textarea", { name: "texto", rows: 4, required: true })));
  } else {
    rapido.titulo.textContent = "Novo lembrete";
    const quando = criar("input", { type: "datetime-local", name: "quando", required: true });
    const daquiUmaHora = new Date(Date.now() + 60 * 60 * 1000);
    daquiUmaHora.setMinutes(0, 0, 0);
    const p = (n) => String(n).padStart(2, "0");
    quando.value = `${daquiUmaHora.getFullYear()}-${p(daquiUmaHora.getMonth() + 1)}-${p(daquiUmaHora.getDate())}T${p(daquiUmaHora.getHours())}:00`;
    rapido.campos.append(
      campo("O que lembrar", criar("input", { name: "texto", required: true, autocomplete: "off" })),
      campo("Quando", quando),
    );
  }
  rapido.dialogo.showModal();
  rapido.campos.querySelector("input:not([type=radio]), textarea")?.focus();
}

rapido.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(rapido.form));
  const caminho = { transacao: "/api/transacoes", nota: "/api/notas", lembrete: "/api/lembretes" }[rapido.tipo];
  if (rapido.tipo === "lembrete") dados.quando = new Date(dados.quando).toISOString();
  rapido.salvar.disabled = true;
  try {
    await api(caminho, { method: "POST", body: JSON.stringify(dados) });
    rapido.dialogo.close();
    atualizarPaineis();
  } catch (erro) {
    rapido.erro.textContent = erro.message;
  } finally {
    rapido.salvar.disabled = false;
  }
});
$("cancelarRapido").addEventListener("click", () => rapido.dialogo.close());
document.querySelectorAll("[data-rapido]").forEach((b) => b.addEventListener("click", () => abrirRapido(b.dataset.rapido)));

// ---------- Ajustes: tema e voz ----------
const TEMAS = [
  ["azul", "Azul", "#00d4ff"], ["vermelho", "Vermelho", "#ffc440"], ["verde", "Verde", "#39ff78"],
  ["roxo", "Roxo", "#c86eff"], ["claro", "Claro", "#0078be"],
];
function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  guardar.escrever("jarvis.tema", tema);
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--fundo").trim();
  document.querySelectorAll(".tema").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.opcao === tema)));
}
for (const [id, nome, cor] of TEMAS) {
  const b = criar("button", { type: "button", className: "tema" });
  b.dataset.opcao = id; // não usar "data-tema": o CSS pintaria o botão com o próprio tema
  const bolinha = criar("i");
  bolinha.style.background = cor;
  bolinha.style.color = cor;
  b.append(bolinha, document.createTextNode(nome));
  b.addEventListener("click", () => aplicarTema(id));
  $("temas").append(b);
}
aplicarTema(document.documentElement.dataset.tema || "azul");

function preencherVozes() {
  const select = $("escolhaVoz");
  const salva = guardar.ler("jarvis.vozNome", "");
  select.replaceChildren(criar("option", { value: "", textContent: "Automática" }));
  for (const v of falando.vozesPt()) select.append(criar("option", { value: v.name, textContent: `${v.name} (${v.lang})`, selected: v.name === salva }));
}
const formatarVelocidade = (v) => `${Number(v).toFixed(2).replace(".", ",")}×`;
$("velocidade").value = String(falando.velocidade);
$("valorVelocidade").textContent = formatarVelocidade(falando.velocidade);
$("velocidade").addEventListener("input", (e) => {
  falando.velocidade = Number(e.target.value);
  guardar.escrever("jarvis.velocidade", e.target.value);
  $("valorVelocidade").textContent = formatarVelocidade(e.target.value);
});
$("escolhaVoz").addEventListener("change", (e) => { guardar.escrever("jarvis.vozNome", e.target.value); falando.escolherVoz(); });
$("testarVoz").addEventListener("click", () => {
  falando.cancelar();
  const ligada = el.voz.checked;
  el.voz.checked = true;
  falando.falar("Olá! Esta é a minha voz. Como posso ajudar?").then(() => definirEstado(null));
  el.voz.checked = ligada;
});
$("botaoAjustes").addEventListener("click", () => { preencherVozes(); $("dialogoAjustes").showModal(); });

// ---------- Google Agenda ----------
const botaoGoogle = $("botaoGoogle");
const horaCurta = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaCurto = (iso) => {
  const d = new Date(iso), hoje = new Date();
  const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === amanha.toDateString()) return "Amanhã";
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
};

async function atualizarAgenda() {
  const ul = $("listaAgenda");
  try {
    const status = await api("/api/google/status");
    botaoGoogle.hidden = status.conectado;
    if (!status.configurado) {
      botaoGoogle.hidden = true;
      preencherLista(ul, [], null, "Google Agenda ainda não configurado (veja o README).");
      return;
    }
    if (!status.conectado) {
      preencherLista(ul, [], null, "Conecte sua conta para o Jarvis ver e marcar compromissos.");
      return;
    }
    const { eventos, erro } = await api("/api/agenda/hoje");
    preencherLista(ul, eventos, (e) => li(e.titulo, `${diaCurto(e.inicio)}${e.diaInteiro ? " · dia inteiro" : ` · ${horaCurta(e.inicio)}`}${e.local ? ` · ${e.local}` : ""}`),
      erro || 'Nada marcado. Ex.: "marca dentista sexta às 14h".');
  } catch (erro) {
    console.warn("Agenda:", erro.message);
  }
}

botaoGoogle.addEventListener("click", async () => {
  try {
    const { url } = await api("/api/google/link", { method: "POST", body: "{}" });
    location.href = url;
  } catch (erro) {
    adicionarMensagem(erro.message, "jarvis erro");
  }
});

// ---------- WhatsApp ----------
const botaoWhatsapp = $("botaoWhatsapp");
api("/api/whatsapp/status").then((s) => (botaoWhatsapp.hidden = !s.configurado)).catch(() => {});
botaoWhatsapp.addEventListener("click", async () => {
  botaoWhatsapp.disabled = true;
  try {
    await api("/api/whatsapp/teste", { method: "POST", body: "{}" });
    adicionarMensagem("Mandei uma mensagem de teste para o seu WhatsApp.", "jarvis");
  } catch (erro) {
    adicionarMensagem(erro.message, "jarvis erro");
  } finally {
    // Espera um pouco antes de liberar de novo: o serviço bloqueia testes seguidos.
    setTimeout(() => (botaoWhatsapp.disabled = false), 60 * 1000);
  }
});

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
  guardar.escrever("jarvis.conversa.dia", hojeLocal());
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
atualizarAgenda();
verificarLembretes();
setInterval(atualizarAgenda, 5 * 60 * 1000);
