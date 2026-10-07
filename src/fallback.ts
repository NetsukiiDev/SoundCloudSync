// Tracce non scaricabili da SoundCloud (DRM, Go+, blocco geografico): cerca lo stesso brano
// altrove e, solo se la corrispondenza è sicura, lo scarica al suo posto.
// Il file prende il nome della traccia SoundCloud (e poi i suoi tag, vedi tagger.ts), così la
// libreria lo tratta come gli altri.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { searchBandcamp } from "./bandcamp.ts";
import { explain } from "./errors.ts";
import { log } from "./log.ts";
import { pickBest, searchQuery, worthChecking } from "./match.ts";
import { rememberSource } from "./tagger.ts";
import * as yt from "./ytdlp.ts";

export interface Source {
  name: string;
  /** presentarsi come browser (serve per SoundCloud) */
  impersonate: boolean;
  search: (query: string, info: yt.TrackInfo) => Promise<yt.SearchResult[]>;
}

/**
 * In ordine di preferenza. Prima SoundCloud stesso: un altro caricamento dello stesso brano
 * (etichetta, artista, compilation) è spesso scaricabile anche quando l'originale non lo è.
 * Poi YouTube Music (audio ufficiale, senza le intro dei videoclip), YouTube, Bandcamp.
 */
export const SOURCES: Source[] = [
  {
    name: "SoundCloud",
    impersonate: true,
    search: async (q, info) => (await yt.searchSoundCloud(q)).filter((c) => c.id !== info.id),
  },
  { name: "YouTube Music", impersonate: false, search: (q) => yt.searchYouTubeMusic(q) },
  { name: "YouTube", impersonate: false, search: (q) => yt.searchYouTube(q) },
  { name: "Bandcamp", impersonate: false, search: (q) => searchBandcamp(q) },
];

export const NOT_FOUND = "non trovata altrove (nessuna corrispondenza sicura)";

/** Quanti risultati senza durata leggere per fonte (ognuno è una chiamata a yt-dlp). */
const MAX_DETAILS = 3;

export interface FoundTrack {
  info: yt.TrackInfo;
  match: yt.SearchResult;
  score: number;
  file: string;
  /** nome della fonte (vedi SOURCES) */
  source: string;
}

/** Ricerca senza risultato. */
export interface Miss {
  reason: string;
  /** fonti che hanno risposto senza una corrispondenza: inutile richiederle per un po' */
  tried: string[];
}

class SearchFailed extends Error {
  readonly tried: string[];
  constructor(tried: string[], errors: string[]) {
    super(errors.length ? `ricerca altrove fallita: ${errors.join(" · ")}` : NOT_FOUND);
    this.tried = tried;
  }
}

/** Risultati con durata e artista, leggendoli per quelli che ne sono privi. */
async function candidates(source: Source, query: string, info: yt.TrackInfo): Promise<yt.SearchResult[]> {
  const found = await source.search(query, info);
  const partial = found.filter((c) => c.duration == null && worthChecking(info, c)).slice(0, MAX_DETAILS);
  const detailed = [];
  for (const c of partial) {
    try {
      detailed.push(await yt.details(c.url, source.impersonate));
    } catch {
      // risultato non leggibile: si scarta
    }
  }
  return [...found.filter((c) => c.duration != null), ...detailed];
}

/**
 * Cerca e scarica in `folder`, provando le fonti in ordine (tranne quelle in `skip`, già
 * provate senza successo). Lancia un errore se nessuna ha una corrispondenza sicura.
 */
export async function findAndDownload(
  url: string,
  folder: string,
  onStatus: (s: yt.Status) => void,
  skip: readonly string[] = [],
): Promise<FoundTrack> {
  onStatus({ text: "leggo i dati da SoundCloud", percent: 0 });
  const info = await yt.trackInfo(url);
  const name = `${info.artist ?? info.uploader ?? "?"} - ${info.track ?? info.title}`;
  const query = searchQuery(info);
  const base = yt.fileBase(info);
  const tried: string[] = [];
  const errors: string[] = [];

  for (const source of SOURCES.filter((s) => !skip.includes(s.name))) {
    onStatus({ text: `cerco su ${source.name}`, title: name, percent: 0 });
    try {
      const best = pickBest(info, await candidates(source, query, info));
      log(`      ${source.name} "${query}": ${best ? `${best.candidate.title} (${best.score.toFixed(2)})` : "nessuna"}`);
      if (!best) {
        tried.push(source.name);
        continue;
      }
      onStatus({ text: `trovata su ${source.name} (${Math.round(best.score * 100)}%)`, title: name });
      await yt.download(best.candidate.url, folder, (s) => onStatus({ ...s, title: name }), {
        name: base,
        impersonate: source.impersonate,
      });
      const file = join(folder, `${base}.mp3`);
      if (!existsSync(file)) throw new Error("ERROR: mp3 non trovato dopo il download (postprocess)");
      rememberSource(info, best.candidate.url); // i tag li scrive tagger.ts, con la fonte nel commento
      return { info, match: best.candidate, score: best.score, file, source: source.name };
    } catch (e) {
      const { reason, raw, permanent } = explain(e);
      log(`ERROR ${source.name}: ${raw}`);
      // es. il caricamento trovato è anch'esso solo Go+: non cambierà alla prossima sync
      if (permanent) tried.push(source.name);
      else errors.push(`${source.name}: ${reason ?? raw}`);
    }
  }
  throw new SearchFailed(tried, errors);
}

/** Perché la ricerca altrove non è andata, e quali fonti non serve riprovare. */
export function failure(err: unknown): Miss {
  if (err instanceof SearchFailed) return { reason: err.message, tried: err.tried };
  const { reason, raw } = explain(err);
  return { reason: `ricerca altrove fallita: ${reason ?? raw}`, tried: [] };
}

/** Fonti non ancora provate per una traccia. */
export const untried = (tried: readonly string[] = []) => SOURCES.filter((s) => !tried.includes(s.name));
