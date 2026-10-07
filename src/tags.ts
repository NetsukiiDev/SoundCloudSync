// Quali tag deve avere una traccia. Solo logica, nessun file: si testa facilmente.
//
// SoundCloud mette come "artista" chi ha caricato la traccia (spesso un'etichetta) e l'artista
// vero dentro il titolo ("Artista - Titolo [FREE DOWNLOAD]"). Qui si rimette tutto in ordine.

export interface TrackMeta {
  id: string;
  title: string;
  uploader: string | null;
  artist: string | null; // dal "publisher metadata" di SoundCloud, se c'è
  track: string | null;
  album: string | null;
  genre: string | null;
  date: string | null; // YYYYMMDD
  url: string;
  /** se il file viene da YouTube (traccia non scaricabile da SoundCloud) */
  source?: string | null;
}

export interface Placement {
  playlist: string;
  index: number; // 1-based
}

export interface Tags {
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  track: string;
  date: string;
  genre: string;
  comment: string;
  compilation: string;
}

export const VARIOUS = "Various Artists";

// Decorazioni promozionali, tra parentesi o in coda al titolo.
const PROMO =
  /free\s*(download|dl)|free\b|premiere|out\s*now|buy\s*=?\s*free|original\s*mix|official\s*(audio|video)|taken\s+from/i;

const same = (a: string, b: string) => a.toLowerCase().replace(/\W/g, "") === b.toLowerCase().replace(/\W/g, "");

/**
 * Toglie le parentesi promozionali: "X (Free Download) [PREMIERE]" -> "X". Tiene remix/edit.
 * Toglie anche le parentesi che contengono solo chi ha caricato la traccia ("[INNERGATED]").
 */
export function cleanTitle(s: string, uploader?: string | null): string {
  let out = s
    .replace(/[([{【]([^)\]}】]*)[)\]}】]/g, (m, inner: string) =>
      PROMO.test(inner) || (uploader && same(inner, uploader)) ? " " : m,
    )
    .replace(/\s*[|｜]\s*(free\s*(download|dl)|out\s*now|premiere)\b.*$/i, "")
    .replace(/\s+I\s+free\s*(download|dl)\s*$/i, "")
    .replace(/\s+-\s*(free\s*(download|dl)|out\s*now)\s*$/i, "")
    .replace(/^\s*(premiere|free\s*(download|dl))\s*[:|-]\s*/i, "");
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([)\]])/g, "$1").trim();
  return out || s.trim();
}

/** "Holy Priest， Bloodlust" -> "Holy Priest, Bloodlust" (SoundCloud usa la virgola larga). */
export const cleanArtist = (s: string) => s.replace(/\s*[，、]\s*/g, ", ").replace(/\s{2,}/g, " ").trim();

/** Artista e titolo veri. */
export function splitTitle(meta: Pick<TrackMeta, "title" | "uploader" | "artist" | "track">): {
  artist: string;
  title: string;
} {
  const raw = cleanTitle(meta.title, meta.uploader);
  const dash = raw.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) return { artist: cleanArtist(dash[1]), title: cleanTitle(dash[2], meta.uploader) };
  const artist = meta.artist || meta.uploader || "Sconosciuto";
  return { artist: cleanArtist(artist), title: cleanTitle(meta.track || raw, meta.uploader) };
}

export function desiredTags(meta: TrackMeta, place: Placement): Tags {
  const { artist, title } = splitTitle(meta);
  const realAlbum = meta.album?.trim();
  return {
    title,
    artist,
    album: realAlbum || place.playlist,
    album_artist: realAlbum ? artist : VARIOUS,
    track: String(place.index),
    date: meta.date?.slice(0, 4) ?? "",
    genre: meta.genre?.trim() ?? "",
    comment: meta.source ? `Scaricata da YouTube: ${meta.source} (originale: ${meta.url})` : meta.url,
    compilation: realAlbum ? "" : "1",
  };
}
