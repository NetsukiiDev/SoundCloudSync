// Tracce non scaricabili da SoundCloud (DRM, Go+, blocco geografico): cerca lo stesso brano
// su YouTube e, solo se la corrispondenza è sicura, lo scarica al suo posto.
// Il file prende il nome della traccia SoundCloud (e poi i suoi tag, vedi tagger.ts), così la
// libreria lo tratta come gli altri.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { explain } from "./errors.ts";
import { log } from "./log.ts";
import { pickBest, searchQuery } from "./match.ts";
import { rememberSource } from "./tagger.ts";
import * as yt from "./ytdlp.ts";

export const NOT_FOUND = "non trovata su YouTube (nessuna corrispondenza sicura)";

export interface FoundTrack {
  info: yt.TrackInfo;
  match: yt.SearchResult;
  score: number;
  file: string;
}

class NotFoundError extends Error {}

/** Cerca e scarica in `folder`. Lancia un errore se non trova una corrispondenza sicura. */
export async function findAndDownload(
  url: string,
  folder: string,
  onStatus: (s: yt.Status) => void,
): Promise<FoundTrack> {
  onStatus({ text: "leggo i dati da SoundCloud", percent: 0 });
  const info = await yt.trackInfo(url);
  const name = `${info.artist ?? info.uploader ?? "?"} - ${info.track ?? info.title}`;
  onStatus({ text: "cerco su YouTube", title: name });

  const query = searchQuery(info);
  const best = pickBest(info, await yt.searchYouTube(query));
  log(`      ricerca "${query}": ${best ? `${best.candidate.title} (${best.score.toFixed(2)})` : "nessuna"}`);
  if (!best) throw new NotFoundError(NOT_FOUND);

  onStatus({ text: `trovata (${Math.round(best.score * 100)}%)`, title: name });
  const base = yt.fileBase(info);
  await yt.download(best.candidate.url, folder, (s) => onStatus({ ...s, title: name }), {
    name: base,
    impersonate: false,
  });
  const file = join(folder, `${base}.mp3`);
  if (!existsSync(file)) throw new Error("ERROR: mp3 non trovato dopo il download (postprocess)");
  rememberSource(info, best.candidate.url); // i tag li scrive tagger.ts, con la fonte nel commento
  return { info, match: best.candidate, score: best.score, file };
}

/** Motivo leggibile per cui la ricerca altrove non è andata. */
export function failureReason(err: unknown): string {
  if (err instanceof NotFoundError) return NOT_FOUND;
  const { reason, raw } = explain(err);
  return `ricerca su YouTube fallita: ${reason ?? raw}`;
}
