// Jarvis no Cloudflare Workers: a API em /api/*, as telas (pasta public) e os lembretes a cada minuto.
// Os dados ficam no banco D1 "jarvis".
import { ArmazemD1 } from "../src/armazem.js";
import { criarJarvis, verificarLembretesWhatsApp } from "../src/rotas.js";

let tratar;

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/api/")) {
      tratar ||= criarJarvis(new ArmazemD1(env.DB));
      return tratar(req);
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(evento, env, ctx) {
    ctx.waitUntil(
      verificarLembretesWhatsApp(new ArmazemD1(env.DB)).then(({ enviados, resumo }) => {
        if (enviados) console.log(`Lembretes enviados ao WhatsApp: ${enviados}`);
        if (resumo) console.log("Resumo diário enviado ao WhatsApp.");
      }),
    );
  },
};
