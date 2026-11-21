// Roda a cada minuto no Netlify: manda para o WhatsApp os lembretes que acabaram de vencer.
import { getStore } from "@netlify/blobs";
import { ArmazemBlobs } from "../../src/armazem.js";
import { verificarLembretesWhatsApp } from "../../src/rotas.js";

export default async () => {
  const { enviados } = await verificarLembretesWhatsApp(new ArmazemBlobs(getStore));
  if (enviados) console.log(`Lembretes enviados ao WhatsApp: ${enviados}`);
};

export const config = { schedule: "* * * * *" };
