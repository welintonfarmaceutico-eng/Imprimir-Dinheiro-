// Roda a cada minuto no Netlify: manda para o WhatsApp os lembretes que acabaram de vencer
// e, na hora marcada (JARVIS_RESUMO_HORA, padrão 7h), o resumo do dia.
import { getStore } from "@netlify/blobs";
import { ArmazemBlobs } from "../../src/armazem.js";
import { verificarLembretesWhatsApp } from "../../src/rotas.js";

export default async () => {
  const { enviados, resumo } = await verificarLembretesWhatsApp(new ArmazemBlobs(getStore));
  if (enviados) console.log(`Lembretes enviados ao WhatsApp: ${enviados}`);
  if (resumo) console.log("Resumo diário enviado ao WhatsApp.");
};

export const config = { schedule: "* * * * *" };
