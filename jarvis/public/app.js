// Interface do Jarvis: voz (ouvir e falar), conversa em tempo real, painéis, temas e cadastro rápido.
const $ = (id) => document.getElementById(id);
const el = {
  conversa: $("conversa"), texto: $("texto"), form: $("formulario"), estado: $("estado"),
  reator: $("reator"), escuta: $("escutaContinua"), voz: $("vozLigada"), nova: $("novaConversa"),
};

// O reconhecimento de voz do Google costuma escrever "Jarvis" de outros jeitos ("Jarbas", "Chaves"...).
const PALAVRA_CHAVE = /(?<!\p{L})(?:jarvis|járvis|jarvi|jarves|jarviz|jarbas|jarbs|garvis|djarvis)(?!\p{L})[,.!?\s]*/iu;
// "Chaves" e parecidos só contam no começo da frase (para não confundir com "as chaves de casa").
const PALAVRA_CHAVE_INICIO = /^\s*(?:chaves|xaves|chavis|charvis|chárvis)(?!\p{L})[,.!?\s]*/iu;
const acharChamado = (frase) => PALAVRA_CHAVE.exec(frase) || PALAVRA_CHAVE_INICIO.exec(frase);
const tirarChamado = (frase) => frase.replace(PALAVRA_CHAVE_INICIO, "").replace(PALAVRA_CHAVE, "");
// Marcas de voz em inglês ([en]...[/en]) não aparecem na tela.
const semMarcas = (t) => String(t ?? "").replace(/\[\/?en\]/gi, "");
// Idioma da próxima escuta ("en-US" depois de tocar em "Responder em inglês").
let idiomaDaEscuta = "";
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

// Núcleo animado (partículas). O formato escolhido fica salvo no navegador.
const nucleo = window.Nucleo ? Nucleo.criar($("nucleo"), { formato: guardar.ler("jarvis.formato", "neural") }) : null;

// O círculo dá um "pulo" a cada palavra falada ou ouvida e volta devagar.
let pulsoTimer = null;
function pulsar(forca = 1.18) {
  nucleo?.pulsar(forca);
  el.reator.style.setProperty("--pulso", String(forca));
  clearTimeout(pulsoTimer);
  pulsoTimer = setTimeout(() => el.reator.style.setProperty("--pulso", "1"), 140);
}

const REPETE = { diario: "todo dia", dias_uteis: "seg a sex", semanal: "toda semana", mensal: "todo mês" };

// Celular ou computador: o Jarvis escolhe entre mostrar um botão (celular) ou abrir direto no PC.
const APARELHO = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent) ? "celular" : "computador";

// Botões para abrir apps e sites (YouTube, Waze, WhatsApp, ligação...). Só aceita http(s) e tel:.
function mostrarBotoes(botoes) {
  if (!Array.isArray(botoes) || !botoes.length) return;
  const caixa = document.createElement("div");
  caixa.className = "botoes-acao";
  for (const b of botoes) {
    if (typeof b?.url !== "string" || !/^(https?:|tel:)/i.test(b.url)) continue;
    const a = document.createElement("a");
    a.className = "botao botao-acao";
    a.href = b.url;
    a.textContent = `▶ ${b.rotulo || "Abrir"}`;
    if (!b.url.startsWith("tel:")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    caixa.appendChild(a);
  }
  if (!caixa.children.length) return;
  el.conversa.appendChild(caixa);
  el.conversa.scrollTop = el.conversa.scrollHeight;
}

// Post do Instagram pronto: mostra o texto com botões para copiar e abrir o Instagram.
function mostrarPosts(posts) {
  if (!Array.isArray(posts)) return;
  for (const p of posts) {
    if (typeof p?.texto !== "string") continue;
    const cartao = document.createElement("div");
    cartao.className = "msg jarvis post-instagram";
    const titulo = document.createElement("strong");
    titulo.textContent = p.titulo ? `📄 ${p.titulo}` : "📸 Post para o Instagram" + (p.melhor_horario ? ` · postar ${p.melhor_horario}` : "");
    const corpo = document.createElement("div");
    corpo.className = "post-texto";
    corpo.textContent = p.texto;
    const acoes = document.createElement("div");
    acoes.className = "botoes-acao";
    const copiar = document.createElement("button");
    copiar.type = "button";
    copiar.className = "botao botao-acao";
    copiar.textContent = p.titulo ? "📋 Copiar documento" : "📋 Copiar legenda";
    copiar.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(p.texto); copiar.textContent = "✅ Copiado!"; }
      catch { copiar.textContent = "Segure no texto para copiar"; }
    });
    const abrir = document.createElement("a");
    abrir.className = "botao-sec botao-acao";
    abrir.href = "https://www.instagram.com/";
    abrir.target = "_blank"; abrir.rel = "noopener noreferrer";
    abrir.textContent = "Abrir o Instagram";
    acoes.append(copiar);
    if (!p.titulo) acoes.append(abrir);
    cartao.append(titulo, corpo, acoes);
    el.conversa.appendChild(cartao);
  }
  el.conversa.scrollTop = el.conversa.scrollHeight;
}

function adicionarMensagem(texto, tipo) {
  const div = document.createElement("div");
  div.className = `msg ${tipo}`;
  div.textContent = texto;
  el.conversa.appendChild(div);
  if (texto && !/digitando|aviso/.test(tipo)) adicionarMeta(div, tipo);
  el.conversa.scrollTop = el.conversa.scrollHeight;
  return div;
}

// Linha embaixo de cada mensagem: horário e, nas respostas do Jarvis, o botão de copiar.
function adicionarMeta(bolha, tipo) {
  if (bolha.nextElementSibling?.classList.contains("msg-meta")) return;
  const meta = document.createElement("div");
  meta.className = `msg-meta ${/usuario/.test(tipo) ? "usuario" : "jarvis"}`;
  const hora = document.createElement("time");
  hora.textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  meta.append(hora);
  if (/jarvis/.test(tipo) && !/erro/.test(tipo)) {
    const copiar = document.createElement("button");
    copiar.type = "button";
    copiar.className = "copiar";
    copiar.textContent = "📋 Copiar";
    copiar.addEventListener("click", async () => {
      const texto = [...bolha.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
      try { await navigator.clipboard.writeText(texto); copiar.textContent = "✅ Copiado"; }
      catch { copiar.textContent = "Segure no texto para copiar"; }
      setTimeout(() => (copiar.textContent = "📋 Copiar"), 2500);
    });
    meta.append(copiar);
  }
  bolha.after(meta);
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

// Perfil de quem está usando: "adulto" ou "estudante" (Modo Escola). As chamadas esperam saber o perfil.
let perfil = "adulto";
const PERMITIDOS_ESTUDANTE = new Set(["/api/perfil", "/api/conversa/limpar"]);
let perfilPronto = null;
function carregarPerfil() {
  perfilPronto ||= fetch("/api/perfil", { headers: { "x-jarvis-senha": senha } })
    .then((r) => (r.ok ? r.json() : { perfil: "adulto" }))
    .then((d) => (perfil = d.perfil || "adulto"))
    .catch(() => "adulto");
  return perfilPronto;
}

async function api(caminho, opcoes = {}) {
  if (caminho !== "/api/perfil") await carregarPerfil();
  if (perfil === "estudante" && !PERMITIDOS_ESTUDANTE.has(caminho)) throw Object.assign(new Error("Indisponível no Modo Escola."), { silencioso: true });
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
async function enviar(texto, anexo = null) {
  texto = texto.trim();
  if ((!texto && !anexo) || ocupado) return;
  ocupado = true;
  pararDeOuvir();
  falando.cancelar();
  adicionarMensagem(anexo ? `📄 ${anexo.nome}${texto ? `\n${texto}` : ""}` : texto, "usuario");
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
    const corpoPedido = { conversa: conversaId, texto, aparelho: APARELHO };
    if (anexo) { corpoPedido.imagem = anexo.imagem; corpoPedido.tipo = anexo.tipo; definirEstado("pensando", "Lendo o documento..."); }
    await conversarAoVivo(corpoPedido, (evento) => {
      if (evento.tipo === "texto") {
        if (!bolha) { bolha = adicionarMensagem("", "jarvis digitando"); definirEstado("falando", "Respondendo..."); }
        escrito += evento.delta;
        paraFalar += evento.delta;
        bolha.textContent = semMarcas(escrito);
        el.conversa.scrollTop = el.conversa.scrollHeight;
        falarFrasesProntas();
      } else if (evento.tipo === "fim") {
        if (!escrito.trim()) { bolha = adicionarMensagem(semMarcas(evento.texto), "jarvis"); paraFalar = evento.texto; }
        falarFrasesProntas(true);
        mostrarBotoes(evento.botoes);
        mostrarPosts(evento.posts);
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
    if (bolha?.textContent) adicionarMeta(bolha, "jarvis");
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
  emIngles: false, // dentro de um trecho [en]...[/en]
  vozIngles() {
    const vozes = "speechSynthesis" in window ? speechSynthesis.getVoices() : [];
    return vozes.find((v) => /^en-us/i.test(v.lang) && /natural|online|google/i.test(v.name))
      || vozes.find((v) => /^en-us/i.test(v.lang)) || vozes.find((v) => /^en/i.test(v.lang)) || null;
  },
  // Põe uma frase na fila de fala. Trechos entre [en] e [/en] são falados com voz em inglês.
  enfileirar(texto) {
    if (!texto) return;
    for (const parte of String(texto).split(/(\[\/?en\])/i)) {
      if (/^\[en\]$/i.test(parte)) this.emIngles = true;
      else if (/^\[\/en\]$/i.test(parte)) this.emIngles = false;
      else this.falarTrecho(parte, this.emIngles);
    }
  },
  falarTrecho(texto, ingles) {
    texto = String(texto ?? "").replace(/^[\s.,;:!?…]+/, ""); // pontuação solta no começo de um trecho
    if (!el.voz.checked || !("speechSynthesis" in window) || !/[\p{L}\p{N}]/u.test(texto)) return;
    const fala = new SpeechSynthesisUtterance(texto.trim());
    fala.lang = ingles ? "en-US" : "pt-BR";
    const voz = ingles ? this.vozIngles() : this.voz;
    if (voz) fala.voice = voz;
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
    this.emIngles = false;
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
let avisouRede = false;

const conversaAberta = () => Date.now() < conversaAbertaAte;

function processarFrase(frase) {
  frase = frase.trim();
  el.texto.value = "";
  if (!frase) return;
  // Sem escuta contínua, logo depois de "Jarvis", ou com a conversa aberta: não precisa da palavra-chave.
  if (!el.escuta.checked || esperandoComando || conversaAberta()) {
    esperandoComando = false;
    conversaAbertaAte = 0;
    enviar(tirarChamado(frase));
    return;
  }
  // Escuta contínua: só responde quando ouvir "Jarvis".
  const chamado = acharChamado(frase);
  if (!chamado) return;
  const pedido = frase.slice(chamado.index + chamado[0].length).trim();
  if (pedido) enviar(pedido);
  else { esperandoComando = true; definirEstado("ouvindo", "Pois não?"); bip(); }
}

function criarReconhecimento() {
  const r = new Reconhecimento();
  r.lang = idiomaDaEscuta || "pt-BR";
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
    } else if (e.error === "audio-capture") {
      el.escuta.checked = false;
      adicionarMensagem("Não achei nenhum microfone. Confira se ele está ligado e escolhido no Windows (Configurações → Som → Entrada).", "aviso");
    } else if (e.error === "network" && !avisouRede) {
      avisouRede = true; // o reconhecimento de voz do Chrome precisa de internet
      adicionarMensagem("O reconhecimento de voz ficou sem internet. Vou continuar tentando.", "aviso");
    }
  };
  r.onend = () => {
    clearTimeout(pausaTimer);
    ouvindo = false;
    idiomaDaEscuta = ""; // "Responder em inglês" vale só para uma resposta
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
    preencherLista($("listaLembretes"), p.lembretes, (l) => li(l.texto, dataHora(l.quando) + (REPETE[l.repetir] ? ` · 🔁 ${REPETE[l.repetir]}` : "")), 'Nenhum lembrete. Ex.: "me lembre de pagar a conta amanhã às 9h".');
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
    const repetir = criar("select", { name: "repetir" });
    for (const [valor, nome] of [["", "Não repetir"], ["diario", "Todo dia"], ["dias_uteis", "De segunda a sexta"], ["semanal", "Toda semana"], ["mensal", "Todo mês"]]) {
      repetir.append(criar("option", { value: valor, textContent: nome }));
    }
    rapido.campos.append(
      campo("O que lembrar", criar("input", { name: "texto", required: true, autocomplete: "off" })),
      campo("Quando", quando),
      campo("Repetir", repetir),
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
  document.querySelectorAll(".tema:not(.formato)").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.opcao === tema)));
  nucleo?.atualizarCores();
  desenharMiniaturas();
}

// Formatos do núcleo, com miniaturas desenhadas na cor do tema.
function desenharMiniaturas() {
  if (!window.Nucleo || !$("dialogoAjustes").open) return;
  document.querySelectorAll(".formato").forEach((b) => Nucleo.miniatura(b.querySelector("canvas"), b.dataset.formato));
}
function escolherFormato(formato) {
  guardar.escrever("jarvis.formato", formato);
  nucleo?.trocarFormato(formato);
  document.querySelectorAll(".formato").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.formato === formato)));
}
if (window.Nucleo) {
  for (const [id, nome] of Object.entries(Nucleo.FORMATOS)) {
    const b = criar("button", { type: "button", className: "tema formato" });
    b.dataset.formato = id;
    b.append(criar("canvas"), document.createTextNode(nome));
    b.addEventListener("click", () => escolherFormato(id));
    $("formatos").append(b);
  }
  escolherFormato(guardar.ler("jarvis.formato", "neural"));
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
$("botaoAjustes").addEventListener("click", () => { preencherVozes(); $("dialogoAjustes").showModal(); desenharMiniaturas(); atualizarStatusPc(); });

// ---------- Computador (Jarvis PC) ----------
function mostrarStatusPc(texto, tipo = "") {
  const p = $("statusPc");
  p.textContent = texto;
  p.className = `nota-pc ${tipo}`;
}
async function atualizarStatusPc() {
  try {
    const { conectado, online } = await api("/api/pc/status");
    $("desconectarPc").hidden = !conectado;
    $("testarPc").disabled = !conectado;
    mostrarStatusPc(conectado
      ? (online ? "🟢 PC ligado e conectado agora. " : "⚪ PC desligado ou programa fechado agora. ") +
        "Peça: \"abre o YouTube no PC\" ou \"aumenta o volume do computador\"."
      : "Baixe o programa e abra no seu computador com Windows. Ele deixa o Jarvis abrir programas, sites e mexer no volume.");
  } catch (erro) {
    mostrarStatusPc(erro.message, "ruim");
  }
}
$("baixarPc").addEventListener("click", async () => {
  try {
    const resp = await fetch("/api/pc/instalador", { headers: { "x-jarvis-senha": senha } });
    if (!resp.ok) throw new Error(resp.status === 401 ? "Entre de novo no Jarvis e tente outra vez." : `Erro ${resp.status}`);
    const link = criar("a", { href: URL.createObjectURL(await resp.blob()), download: "jarvis-pc.ps1" });
    document.body.append(link);
    link.click();
    link.remove();
    mostrarStatusPc("Baixado! No computador: aperte Windows + R, digite powershell e Enter. Na janela, digite: powershell -ExecutionPolicy Bypass -File e arraste o arquivo baixado para dentro dela. Aperte Enter.", "ok");
    $("desconectarPc").hidden = false;
    $("testarPc").disabled = false;
  } catch (erro) {
    mostrarStatusPc(erro.message, "ruim");
  }
});
$("testarPc").addEventListener("click", async () => {
  mostrarStatusPc("Chamando o PC...");
  try {
    const r = await api("/api/pc/testar", { method: "POST", body: "{}" });
    mostrarStatusPc(r.mensagem || "PC conectado!", "ok");
  } catch (erro) {
    mostrarStatusPc(erro.message, "ruim");
  }
});
$("desconectarPc").addEventListener("click", async () => {
  if (!confirm("Desconectar o PC? O programa do computador para de receber ordens até você baixar de novo.")) return;
  await api("/api/pc/desconectar", { method: "POST", body: "{}" }).catch(() => {});
  atualizarStatusPc();
});

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
    adicionarMensagem("Mandei o resumo do dia para o seu WhatsApp.", "jarvis");
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

// ---------- Foto de nota fiscal: o Jarvis lê e anota o gasto ----------
// Reduz a foto no próprio aparelho (mais rápido e mais barato) e manda como JPEG.
async function prepararFoto(arquivo, lado = 1600) {
  const imagem = await createImageBitmap(arquivo);
  const escala = Math.min(1, lado / Math.max(imagem.width, imagem.height));
  const tela = document.createElement("canvas");
  tela.width = Math.round(imagem.width * escala);
  tela.height = Math.round(imagem.height * escala);
  tela.getContext("2d").drawImage(imagem, 0, 0, tela.width, tela.height);
  return tela.toDataURL("image/jpeg", 0.85).split(",")[1];
}

// Arquivo escolhido no 📷: pergunta se é para analisar o documento ou anotar a nota fiscal.
let arquivoEscolhido = null;
$("fotoNota").addEventListener("change", (e) => {
  const arquivo = e.target.files?.[0];
  e.target.value = ""; // permite mandar o mesmo arquivo de novo
  if (!arquivo || ocupado) return;
  arquivoEscolhido = arquivo;
  const pdf = arquivo.type === "application/pdf";
  $("nomeArquivo").textContent = `${pdf ? "📄" : "🖼️"} ${arquivo.name || "foto"}`;
  $("notaFoto").hidden = pdf;
  $("perguntaFoto").value = "";
  $("dialogoFoto").showModal();
});
$("cancelarFoto").addEventListener("click", () => $("dialogoFoto").close());

async function lerArquivo(arquivo) {
  if (arquivo.type === "application/pdf") {
    if (arquivo.size > 5 * 1024 * 1024) throw new Error("O PDF é grande demais (máximo 5 MB).");
    const dados = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = falha; r.readAsDataURL(arquivo); });
    return { imagem: String(dados).split(",")[1], tipo: "application/pdf" };
  }
  return { imagem: await prepararFoto(arquivo, 2000), tipo: "image/jpeg" }; // documento: um pouco maior, para ler letra pequena
}

$("analisarFoto").addEventListener("click", async () => {
  const arquivo = arquivoEscolhido;
  const pergunta = $("perguntaFoto").value;
  $("dialogoFoto").close();
  if (!arquivo) return;
  try {
    const anexo = await lerArquivo(arquivo);
    await enviar(pergunta, { ...anexo, nome: arquivo.type === "application/pdf" ? (arquivo.name || "documento.pdf") : "Foto de documento" });
  } catch (erro) {
    adicionarMensagem(erro.message, "jarvis erro");
  }
});

$("notaFoto").addEventListener("click", () => {
  const arquivo = arquivoEscolhido;
  $("dialogoFoto").close();
  if (arquivo) anotarNotaFiscal(arquivo);
});

async function anotarNotaFiscal(arquivo) {
  if (ocupado) return;
  ocupado = true;
  pararDeOuvir();
  adicionarMensagem("📷 Foto de nota fiscal", "usuario");
  definirEstado("pensando", "Lendo a nota...");
  try {
    const r = await api("/api/nota-fiscal", { method: "POST", body: JSON.stringify({ imagem: await prepararFoto(arquivo), tipo: "image/jpeg" }) });
    const bolha = adicionarMensagem(r.texto, "jarvis");
    if (r.transacao) {
      const desfazer = criar("button", { type: "button", className: "botao-sec botao-desfazer", textContent: "Desfazer" });
      desfazer.addEventListener("click", async () => {
        desfazer.disabled = true;
        try {
          await api("/api/transacoes/apagar", { method: "POST", body: JSON.stringify({ id: r.transacao.id }) });
          bolha.textContent = "Gasto da nota desfeito.";
          atualizarPaineis();
        } catch (erro) { desfazer.disabled = false; adicionarMensagem(erro.message, "jarvis erro"); }
      });
      bolha.append(" ", desfazer);
      atualizarPaineis();
    }
    await falando.falar(r.texto);
  } catch (erro) {
    adicionarMensagem(erro.message, "jarvis erro");
  } finally {
    ocupado = false;
    definirEstado(null);
    if (el.escuta.checked) comecarAOuvir();
  }
}


// ---------- Telegram (conversar pelo Telegram e pelo Android Auto) ----------
async function atualizarTelegram() {
  const status = $("statusTelegram");
  try {
    const t = await api("/api/telegram/status");
    $("conectarTelegram").hidden = !t.configurado;
    status.textContent = !t.configurado
      ? "Ainda não configurado: falta colocar o TELEGRAM_BOT_TOKEN no Cloudflare."
      : t.conectado
        ? `🟢 Conectado${t.bot ? ` ao @${t.bot}` : ""}. Fale com o Jarvis pelo Telegram, inclusive no carro.`
        : "Toque em Conectar Telegram e depois em Abrir o Telegram.";
    $("conectarTelegram").textContent = t.conectado ? "Conectar de novo" : "Conectar Telegram";
  } catch (erro) {
    status.textContent = erro.message;
  }
}
$("conectarTelegram").addEventListener("click", async () => {
  const botao = $("conectarTelegram");
  botao.disabled = true;
  try {
    const r = await api("/api/telegram/conectar", { method: "POST", body: "{}" });
    const abrir = $("abrirTelegram");
    abrir.href = r.link;
    abrir.hidden = false;
    $("statusTelegram").textContent = `Agora toque em "Abrir o Telegram" e depois em COMEÇAR (Start) na conversa com @${r.bot}. O código vale 15 minutos.`;
  } catch (erro) {
    $("statusTelegram").textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
});
$("botaoAjustes").addEventListener("click", atualizarTelegram);

// ---------- Instagram (avisos de comentários e mensagens) ----------
async function atualizarInstagram() {
  const status = $("statusInstagram");
  try {
    const r = await api("/api/instagram/status");
    status.textContent = !r.configurado
      ? "Ainda não ligado: falta colocar o INSTAGRAM_TOKEN no Cloudflare."
      : r.erro ? `⚠️ ${r.erro}` : `🟢 Ligado a @${r.conta}. Comentários e mensagens novas chegam no WhatsApp e no Telegram.`;
  } catch (erro) {
    status.textContent = erro.message;
  }
}
$("botaoAjustes").addEventListener("click", atualizarInstagram);

// ---------- Abas (no celular, uma seção por vez; no computador, tudo lado a lado) ----------
function irPara(aba) {
  document.body.dataset.aba = aba;
  guardar.escrever("jarvis.aba", aba);
  document.querySelectorAll("#abas [data-ir]").forEach((b) => b.setAttribute("aria-current", b.dataset.ir === aba ? "page" : "false"));
  if (aba === "inicio") el.conversa.scrollTop = el.conversa.scrollHeight;
  if (aba === "toledo") atualizarToledo();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll("#abas [data-ir]").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.ir)));
$("abaAjustes").addEventListener("click", () => $("botaoAjustes").click());

// ---------- Atalhos embaixo da conversa ----------
const ATALHOS = [
  { rotulo: "⚖️ Advogado", texto: "Pergunta jurídica: " },
  { rotulo: "💊 Farmácia", texto: "Pergunta de farmácia: " },
  { rotulo: "🧮 Contador", texto: "Pergunta para o contador: " },
  { rotulo: "🏠 Imóveis", texto: "Sobre imóveis: " },
  { rotulo: "📄 Documento", acao: "arquivo" },
  { rotulo: "🧾 Nota fiscal", acao: "arquivo" },
  { rotulo: "📸 Post Instagram", texto: "Faz um post do Instagram da Porto e Toledo sobre " },
  { rotulo: "🏢 Resumo Toledo", enviar: "Me dá um resumo da Porto e Toledo" },
  { rotulo: "💰 Gastos do mês", enviar: "Como estão meus gastos este mês?" },
];
montarAtalhos(ATALHOS);

// ---------- Resumo de hoje (topo do Início) ----------
async function atualizarHoje() {
  const caixa = $("hoje");
  try {
    const h = await api("/api/hoje");
    const itens = [];
    if (h.previsao) itens.push(`🌤️ ${h.previsao.maxima}° / ${h.previsao.minima}° · ${h.previsao.condicao}${h.previsao.chuva != null ? ` · ${h.previsao.chuva}% chuva` : ""}`);
    if (h.proximoEvento) itens.push(`📅 ${h.proximoEvento.diaInteiro ? "" : horaCurta(h.proximoEvento.inicio) + " "}${h.proximoEvento.titulo}`);
    if (h.proximoLembrete) itens.push(`⏰ ${dataHora(h.proximoLembrete.quando)} · ${h.proximoLembrete.texto}`);
    if (h.toledo) itens.push(h.toledo.atrasos ? `🔴 ${h.toledo.atrasos} em atraso · ${moeda(h.toledo.totalAtraso)}` : "🟢 Toledo sem atrasos");
    caixa.replaceChildren(...itens.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
    caixa.hidden = !itens.length;
  } catch {
    caixa.hidden = true;
  }
}
atualizarHoje();
setInterval(atualizarHoje, 10 * 60 * 1000);

// ---------- Painel da Porto e Toledo ----------
let toledoCarregadoEm = 0;
const dataCurta = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "");
const primeiro = (obj, chaves) => chaves.map((c) => obj?.[c]).find((v) => v != null && v !== "");
async function atualizarToledo(forcar = false) {
  if (!forcar && Date.now() - toledoCarregadoEm < 2 * 60 * 1000) return;
  toledoCarregadoEm = Date.now();
  const status = $("statusToledo");
  try {
    const d = await api("/api/toledo/painel");
    if (!d.configurado || d.erro) {
      status.textContent = d.erro ? `⚠️ ${d.erro}` : "O sistema Porto e Toledo ainda não está ligado ao Jarvis.";
      status.hidden = false; $("kpisToledo").hidden = $("listasToledo").hidden = true;
      return;
    }
    status.hidden = true;
    $("kpisToledo").hidden = $("listasToledo").hidden = false;
    $("tRecebido").textContent = moeda(d.recebidoNoMes?.total);
    $("tRecebidoDetalhe").textContent = d.recebidoNoMes?.alugueis != null ? `aluguéis ${moeda(d.recebidoNoMes.alugueis)} · vendas ${moeda(d.recebidoNoMes.vendas)}` : "";
    $("tAReceber").textContent = moeda(d.aReceberNoMes?.total);
    $("tAtraso").textContent = moeda(d.emAtraso?.total);
    $("tAtraso").className = d.emAtraso?.quantidade ? "valor saida" : "valor entrada";
    $("tOcupacao").textContent = `${d.imoveis?.alugados ?? 0} de ${d.imoveis?.total ?? 0}`;
    preencherLista($("listaAtrasos"), d.emAtraso?.itens || [], (i) => li(`${i.nome} · ${i.imovel}`, `${i.dias} dia${i.dias === 1 ? "" : "s"} · ${moeda(i.totalComEncargos ?? i.valor)}`), "Nada em atraso. 🎉");
    preencherLista($("listaVencendo"), d.vencendoEm7Dias?.itens || [], (i) => li(`${i.nome}${i.imovel ? ` · ${i.imovel}` : ""}`, `${dataCurta(i.vencimento)} · ${moeda(i.valor)}`), "Nada vence nos próximos 7 dias.");
    preencherLista($("listaLotes"), d.vendasDeLotes || [], (v) => {
      const titulo = primeiro(v, ["lote", "imovel", "descricao", "titulo"]) || "Lote";
      const quem = primeiro(v, ["comprador", "nome", "cliente"]);
      const saldo = primeiro(v, ["saldo", "saldoDevedor", "restante"]);
      const proxima = primeiro(v, ["proximoVencimento", "proximaParcela", "vencimento"]);
      return li(`${titulo}${quem ? ` · ${quem}` : ""}`, [saldo != null && `saldo ${moeda(saldo)}`, proxima && `próxima ${dataCurta(proxima)}`].filter(Boolean).join(" · "));
    }, "Nenhuma venda de lote em andamento.");
  } catch (erro) {
    status.textContent = erro.message; status.hidden = false;
  }
}
$("atualizarToledo").addEventListener("click", () => atualizarToledo(true));
if (window.matchMedia("(min-width: 961px)").matches) atualizarToledo();

// ---------- Ajustes: estado do Google e do WhatsApp ----------
async function atualizarConexoes() {
  try {
    const g = await api("/api/google/status");
    $("statusGoogle").textContent = !g.configurado ? "⚪ Não configurado." : g.conectado ? "🟢 Conectado." : "⚪ Desconectado: toque em \"Conectar Google Agenda\" na Agenda.";
  } catch (erro) { $("statusGoogle").textContent = erro.message; }
  try {
    const w = await api("/api/whatsapp/status");
    $("statusWhatsapp").textContent = w.configurado ? "🟢 Ligado: lembretes e resumo das 7h chegam no WhatsApp." : "⚪ Não configurado.";
  } catch (erro) { $("statusWhatsapp").textContent = erro.message; }
}
$("botaoAjustes").addEventListener("click", atualizarConexoes);

// Abre na última aba usada (depois de tudo carregado).
irPara(guardar.ler("jarvis.aba", "inicio"));

// ---------- Modo Escola (senha da estudante): só o professor, com atalhos de matérias ----------
const ATALHOS_ESCOLA = [
  { rotulo: "📷 Foto do dever", acao: "arquivo" },
  { rotulo: "📐 Matemática", texto: "Me ajuda em matemática: " },
  { rotulo: "📖 Português", texto: "Me ajuda em português: " },
  { rotulo: "🇺🇸 Inglês", enviar: "Vamos treinar inglês?" },
  { rotulo: "🎤 Responder em inglês", acao: "ingles" },
  { rotulo: "🔬 Ciências", texto: "Me ajuda em ciências: " },
  { rotulo: "🌎 História e Geografia", texto: "Me ajuda em história e geografia: " },
  { rotulo: "🎯 Quiz", enviar: "Vamos fazer um quiz divertido sobre o que eu estou estudando!" },
];
function montarAtalhos(lista) {
  const caixa = $("atalhos");
  caixa.replaceChildren();
  for (const a of lista) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "atalho";
    b.textContent = a.rotulo;
    b.addEventListener("click", () => {
      if (a.acao === "arquivo") return $("fotoNota").click();
      if (a.acao === "ingles") {
        // A próxima fala é entendida em inglês (para responder ao professor em inglês).
        pararDeOuvir();
        idiomaDaEscuta = "en-US";
        esperandoComando = true;
        comecarAOuvir();
        definirEstado("ouvindo", "Fale em inglês...");
        return;
      }
      if (a.enviar) return enviar(a.enviar);
      el.texto.value = a.texto;
      el.texto.focus();
      el.texto.setSelectionRange(a.texto.length, a.texto.length);
    });
    caixa.appendChild(b);
  }
}

carregarPerfil().then(() => {
  if (perfil !== "estudante") return;
  document.body.dataset.perfil = "estudante";
  montarAtalhos(ATALHOS_ESCOLA);
  $("notaFoto").hidden = true;
  $("perguntaFoto").placeholder = "Ex.: me ajuda nesse exercício de frações?";
  el.texto.placeholder = "Pergunte ao professor Jarvis...";
  el.conversa.replaceChildren();
  adicionarMensagem("Oi! Eu sou o Jarvis, seu professor particular. Vamos estudar? Você pode mandar a foto do dever, pedir ajuda em qualquer matéria ou treinar inglês comigo!", "jarvis");
});
// Garante que o diálogo de arquivo não ofereça "Anotar gasto" no Modo Escola.
$("fotoNota").addEventListener("change", () => { if (perfil === "estudante") $("notaFoto").hidden = true; });

// Trocar de pessoa (adulto ou Modo Escola): esquece a senha salva neste aparelho.
$("sairJarvis").addEventListener("click", () => {
  guardar.escrever("jarvis.senha", "");
  guardar.escrever("jarvis.conversa", "");
  location.reload();
});
