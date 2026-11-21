// Servidor local do Jarvis (para rodar no seu computador).
// No Netlify, quem atende a API é netlify/functions/api.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ArmazemArquivo } from "./src/armazem.js";
import { criarJarvis, verificarLembretesWhatsApp } from "./src/rotas.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(aqui, "public");
const PORTA = Number(process.env.PORT || 3000);

const armazem = new ArmazemArquivo(process.env.JARVIS_DADOS || path.join(aqui, "dados", "jarvis.json"));
const tratar = criarJarvis(armazem);

// Lembretes no WhatsApp: confere a cada minuto (no Netlify, quem faz isso é a função agendada).
setInterval(() => verificarLembretesWhatsApp(armazem).catch((e) => console.error(e)), 60 * 1000);

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

function arquivoEstatico(pathname) {
  const alvo = path.resolve(PUBLICO, "." + decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
  if (!alvo.startsWith(PUBLICO + path.sep)) return null; // não deixa sair da pasta public
  return fs.existsSync(alvo) && fs.statSync(alvo).isFile() ? alvo : null;
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      const temCorpo = !["GET", "HEAD"].includes(req.method);
      const resposta = await tratar(new Request(url, {
        method: req.method,
        headers: req.headers,
        body: temCorpo ? Readable.toWeb(req) : undefined,
        duplex: temCorpo ? "half" : undefined,
      }));
      res.writeHead(resposta.status, Object.fromEntries(resposta.headers));
      if (resposta.body) Readable.fromWeb(resposta.body).pipe(res); // repassa aos poucos (respostas em tempo real)
      else res.end();
      return;
    }

    const arquivo = arquivoEstatico(url.pathname);
    if (!arquivo) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Não encontrado");
      return;
    }
    res.writeHead(200, { "content-type": TIPOS[path.extname(arquivo)] || "application/octet-stream" });
    fs.createReadStream(arquivo).pipe(res);
  } catch (erro) {
    console.error(erro);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ erro: "Erro interno" }));
  }
});

servidor.listen(PORTA, () => {
  console.log(`Jarvis online em http://localhost:${PORTA}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Aviso: ANTHROPIC_API_KEY não definida. Crie o arquivo .env (veja .env.exemplo).");
  }
});
