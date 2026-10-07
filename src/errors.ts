// Traduce gli errori di yt-dlp in motivi leggibili.

import { stripVTControlCharacters } from "node:util";

export interface Explained {
  reason: string | null;
  raw: string;
  /** non si risolve riprovando (DRM, Go+, traccia rimossa, blocco geografico) */
  permanent: boolean;
}

const PREFIX = /^ERROR:\s*(\[[^\]]+\]\s*)?(\S+:\s*)?/;

// [parole chiave, motivo, permanente]
const RULES: [string[], string, boolean][] = [
  [["drm"], "Protetta da DRM: non scaricabile", true],
  [["403"], "Accesso negato (403) – limite di richieste o traccia privata", false],
  [["404", "not found"], "Traccia rimossa o non trovata", true],
  [["go+", "preview", "premium", "subscription", "requested format"], "Disponibile solo con SoundCloud Go+", true],
  [["geo", "country"], "Non disponibile nel tuo paese", true],
  [["ffmpeg", "postprocess"], "Errore di conversione (ffmpeg)", false],
  [["timed out", "connection"], "Problema di rete", false],
];

export function explain(err: unknown): Explained {
  const text = err instanceof Error ? err.message : String(err);
  const raw = stripVTControlCharacters(text).trim().replace(PREFIX, "").trim();
  const low = raw.toLowerCase();
  const rule = RULES.find(([keys]) => keys.some((k) => low.includes(k)));
  return { reason: rule?.[1] ?? null, raw, permanent: rule?.[2] ?? false };
}
