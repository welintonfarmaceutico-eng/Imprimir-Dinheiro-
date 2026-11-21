// API do Jarvis no Netlify. Os dados ficam no Netlify Blobs.
import { getStore } from "@netlify/blobs";
import { ArmazemBlobs } from "../../src/armazem.js";
import { criarJarvis } from "../../src/rotas.js";

let tratar;

export default async (req) => {
  tratar ||= criarJarvis(new ArmazemBlobs(getStore));
  return tratar(req);
};

export const config = { path: "/api/*" };
