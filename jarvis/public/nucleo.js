// Núcleo animado do Jarvis: partículas em 3D desenhadas num <canvas>.
// Formatos: neural, galaxia, aneis, cristal, enxame. Reage ao estado (repouso, ouvindo, pensando, falando).
(function () {
  const FORMATOS = {
    neural: "Rede neural",
    galaxia: "Galáxia",
    aneis: "Anéis",
    cristal: "Cristal",
    enxame: "Enxame",
  };

  // Gerador pseudoaleatório fixo: o mesmo formato sempre nasce igual.
  function aleatorio(semente) {
    let s = semente >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // Cria os pontos (x, y, z em torno de 0, raio ~1) e as ligações de cada formato.
  function gerar(formato, total) {
    const r = aleatorio(42);
    const pontos = [];
    const ligacoes = [];
    if (formato === "neural") {
      const ouro = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < total; i++) {
        const y = 1 - (i / (total - 1)) * 2;
        const raio = Math.sqrt(1 - y * y);
        const a = ouro * i;
        const k = 0.72 + r() * 0.28;
        pontos.push({ x: Math.cos(a) * raio * k, y: y * k, z: Math.sin(a) * raio * k, t: r() });
      }
      // Liga cada ponto aos vizinhos mais próximos.
      for (let i = 0; i < pontos.length; i++) {
        const perto = [];
        for (let j = i + 1; j < pontos.length; j++) {
          const dx = pontos[i].x - pontos[j].x, dy = pontos[i].y - pontos[j].y, dz = pontos[i].z - pontos[j].z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < 0.09) perto.push([d, j]);
        }
        perto.sort((a, b) => a[0] - b[0]).slice(0, 2).forEach(([, j]) => ligacoes.push([i, j]));
      }
    } else if (formato === "galaxia") {
      const bracos = 3;
      for (let i = 0; i < total; i++) {
        const braco = i % bracos;
        const d = Math.pow(r(), 0.7);
        const a = (braco / bracos) * Math.PI * 2 + d * 4.2 + (r() - 0.5) * 0.5;
        const espalha = (1 - d) * 0.12 + 0.03;
        pontos.push({ x: Math.cos(a) * d + (r() - 0.5) * espalha, y: (r() - 0.5) * 0.12 * (1 - d), z: Math.sin(a) * d + (r() - 0.5) * espalha, t: r() });
      }
    } else if (formato === "aneis") {
      const aneis = [[0.95, 0.3, 0], [0.75, -0.9, 0.6], [0.55, 1.3, -0.4]];
      for (let i = 0; i < total; i++) {
        const [raio, incl, giro] = aneis[i % aneis.length];
        const a = r() * Math.PI * 2;
        let x = Math.cos(a) * raio, y = 0, z = Math.sin(a) * raio;
        // Inclina cada anel num eixo diferente.
        const y1 = y * Math.cos(incl) - z * Math.sin(incl), z1 = y * Math.sin(incl) + z * Math.cos(incl);
        const x2 = x * Math.cos(giro) - z1 * Math.sin(giro), z2 = x * Math.sin(giro) + z1 * Math.cos(giro);
        pontos.push({ x: x2, y: y1, z: z2, t: r(), anel: i % aneis.length });
      }
    } else if (formato === "cristal") {
      const raios = 14;
      const direcoes = [];
      for (let k = 0; k < raios; k++) {
        const y = 1 - (k / (raios - 1)) * 2, raio = Math.sqrt(1 - y * y), a = k * 2.4;
        direcoes.push([Math.cos(a) * raio, y, Math.sin(a) * raio]);
      }
      for (let i = 0; i < total; i++) {
        const [dx, dy, dz] = direcoes[i % raios];
        const d = Math.pow(r(), 1.6) * (0.6 + 0.4 * ((i % 3) / 2));
        pontos.push({ x: dx * d, y: dy * d, z: dz * d, t: r() });
      }
    } else {
      // enxame: nuvem que se mexe sozinha
      for (let i = 0; i < total; i++) {
        const u = r(), v = r(), d = Math.cbrt(r()) * 0.95;
        const teta = u * Math.PI * 2, fi = Math.acos(2 * v - 1);
        pontos.push({ x: d * Math.sin(fi) * Math.cos(teta), y: d * Math.cos(fi), z: d * Math.sin(fi) * Math.sin(teta), t: r(), vel: 0.5 + r() });
      }
    }
    return { pontos, ligacoes };
  }

  function corDoTema() {
    const css = getComputedStyle(document.documentElement);
    return {
      acento: css.getPropertyValue("--acento-rgb").trim() || "0, 212, 255",
      claro: css.getPropertyValue("--nucleo-centro").trim() || "#ffffff",
      verde: css.getPropertyValue("--verde").trim() || "#2ef2a0",
    };
  }

  function hexParaRgb(hex) {
    const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : "46, 242, 160";
  }

  // Desenha um quadro. "e" = energia (0 a 1), "pulso" = impulso da voz (1 = parado).
  function desenhar(ctx, tamanho, modelo, formato, tempo, ang, e, pulso, cores, corRgb) {
    const meio = tamanho / 2;
    const escala = tamanho * 0.36 * (1 + (pulso - 1) * 0.6);
    ctx.clearRect(0, 0, tamanho, tamanho);

    // Brilho do centro.
    const brilho = ctx.createRadialGradient(meio, meio, 0, meio, meio, tamanho * 0.42);
    brilho.addColorStop(0, `rgba(${corRgb}, ${0.18 + e * 0.32})`);
    brilho.addColorStop(0.5, `rgba(${corRgb}, ${0.05 + e * 0.1})`);
    brilho.addColorStop(1, `rgba(${corRgb}, 0)`);
    ctx.fillStyle = brilho;
    ctx.fillRect(0, 0, tamanho, tamanho);

    ctx.globalCompositeOperation = "lighter";
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const inclinacao = formato === "galaxia" ? 1.05 : 0.35;
    const ci = Math.cos(inclinacao), si = Math.sin(inclinacao);
    const proj = new Array(modelo.pontos.length);

    for (let i = 0; i < modelo.pontos.length; i++) {
      const p = modelo.pontos[i];
      let { x, y, z } = p;
      if (formato === "enxame") {
        const w = tempo * 0.0006 * p.vel;
        x += Math.sin(w + p.t * 9) * 0.08; y += Math.cos(w * 1.3 + p.t * 7) * 0.08; z += Math.sin(w * 0.7 + p.t * 5) * 0.08;
      }
      if (formato === "aneis") {
        // Cada anel gira numa velocidade.
        const extra = tempo * 0.0004 * (p.anel + 1) * (p.anel % 2 ? -1 : 1);
        const c2 = Math.cos(extra), s2 = Math.sin(extra);
        [x, z] = [x * c2 - z * s2, x * s2 + z * c2];
      }
      // Gira em torno do eixo vertical e inclina para dar profundidade.
      const xr = x * cos - z * sin, zr = x * sin + z * cos;
      const yr = y * ci - zr * si, zz = y * si + zr * ci;
      const perspectiva = 2.6 / (2.6 + zz);
      proj[i] = { x: meio + xr * escala * perspectiva, y: meio + yr * escala * perspectiva, z: zz, p: perspectiva, t: p.t };
    }

    // Ligações (rede neural).
    if (modelo.ligacoes.length) {
      ctx.lineWidth = Math.max(0.5, tamanho / 420);
      for (const [a, b] of modelo.ligacoes) {
        const pa = proj[a], pb = proj[b];
        const alfa = (0.08 + e * 0.22) * ((pa.p + pb.p) / 2 - 0.55);
        if (alfa <= 0) continue;
        ctx.strokeStyle = `rgba(${corRgb}, ${alfa})`;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
    }

    // Pontos: os da frente são maiores e mais fortes; alguns piscam.
    const base = tamanho / 170;
    for (const q of proj) {
      const pisca = 0.6 + 0.4 * Math.sin(tempo * 0.003 + q.t * 20);
      const alfa = Math.min(1, (0.25 + e * 0.6) * (q.p - 0.4) * 1.4 * pisca);
      if (alfa <= 0.02) continue;
      const raio = base * q.p * (0.7 + e * 0.6);
      ctx.fillStyle = q.t > 0.93 ? `rgba(255, 255, 255, ${alfa})` : `rgba(${corRgb}, ${alfa})`;
      ctx.beginPath(); ctx.arc(q.x, q.y, raio, 0, Math.PI * 2); ctx.fill();
    }

    // Miolo luminoso.
    const miolo = ctx.createRadialGradient(meio, meio, 0, meio, meio, tamanho * (0.07 + e * 0.05) * pulso);
    miolo.addColorStop(0, `rgba(255, 255, 255, ${0.55 + e * 0.4})`);
    miolo.addColorStop(0.4, `rgba(${corRgb}, ${0.35 + e * 0.3})`);
    miolo.addColorStop(1, `rgba(${corRgb}, 0)`);
    ctx.fillStyle = miolo;
    ctx.beginPath(); ctx.arc(meio, meio, tamanho * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // Núcleo principal, animado.
  function criar(canvas, { formato = "neural", total } = {}) {
    const ctx = canvas.getContext("2d");
    const quieto = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const estado = { formato, modelo: null, ang: 0, e: 0.4, pulso: 1, impulso: 1, cores: corDoTema(), ultimo: 0 };
    const pontosPorFormato = () => total || (innerWidth < 700 ? 170 : 240);
    estado.modelo = gerar(formato, pontosPorFormato());

    function ajustarTamanho() {
      const css = canvas.getBoundingClientRect().width || 200;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.height = Math.round(css * dpr);
      estado.tamanho = canvas.width;
    }
    ajustarTamanho();
    addEventListener("resize", ajustarTamanho);

    function quadro(agora) {
      const dt = Math.min(64, agora - (estado.ultimo || agora));
      estado.ultimo = agora;
      const b = document.body.classList;
      const alvo = b.contains("ouvindo") ? 0.85 : b.contains("falando") ? 0.75 : b.contains("pensando") ? 0.7 : 0.5;
      const velocidade = (b.contains("pensando") ? 0.0016 : b.contains("ouvindo") ? 0.0007 : 0.00025) * (quieto ? 0.3 : 1);
      estado.e += (alvo - estado.e) * Math.min(1, dt * 0.004);
      estado.ang += velocidade * dt;
      estado.pulso += (estado.impulso - estado.pulso) * Math.min(1, dt * 0.02);
      estado.impulso += (1 - estado.impulso) * Math.min(1, dt * 0.006);
      const corRgb = b.contains("ouvindo") ? hexParaRgb(estado.cores.verde) : estado.cores.acento;
      desenhar(ctx, estado.tamanho, estado.modelo, estado.formato, agora, estado.ang, estado.e, estado.pulso, estado.cores, corRgb);
      requestAnimationFrame(quadro);
    }
    requestAnimationFrame(quadro);

    return {
      trocarFormato(novo) { estado.formato = novo; estado.modelo = gerar(novo, pontosPorFormato()); },
      atualizarCores() { estado.cores = corDoTema(); },
      pulsar(forca) { estado.impulso = Math.max(estado.impulso, forca); },
    };
  }

  // Miniatura parada (para escolher o formato nos Ajustes).
  function miniatura(canvas, formato) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = canvas.getBoundingClientRect().width || 64;
    canvas.width = canvas.height = Math.round(css * dpr);
    const cores = corDoTema();
    desenhar(ctx, canvas.width, gerar(formato, 160), formato, 1200, 0.6, 0.7, 1, cores, cores.acento);
  }

  window.Nucleo = { FORMATOS, criar, miniatura, gerar, desenhar };
})();
