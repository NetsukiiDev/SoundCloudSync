// Tutto ciò che parla con SoundCloud, tramite il comando yt-dlp.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { log } from "./log.ts";

export const SINGLES = "Tracce singole";

export interface Track {
  id: string;
  title: string;
  url: string;
  /** posizione nella playlist, da 1 */
  index: number;
}

/** Una cartella da sincronizzare: o ha già le tracce, o un url da leggere dopo. */
export interface Playlist {
  name: string;
  url: string | null;
  tracks: Track[] | null;
}

export interface Status {
  text: string;
  title?: string; // "Artista - Titolo", appena yt-dlp lo conosce
  percent?: number;
  speed?: number; // byte/s
  bytes?: number; // scaricati finora
}

const running = new Set<ChildProcess>();

/** Ferma tutti i yt-dlp in corso (Ctrl+C). */
export function killAll(): void {
  for (const p of running) p.kill("SIGTERM");
}

let impersonate: string[] | null = null;

/**
 * SoundCloud rifiuta (403) le connessioni riconosciute come yt-dlp: ci presentiamo come un
 * browser. Serve curl_cffi (pacchetto python-curl_cffi); senza, si prova lo stesso.
 */
function impersonateArgs(): string[] {
  if (impersonate) return impersonate;
  const r = spawnSync("yt-dlp", ["--list-impersonate-targets"], { encoding: "utf8" });
  const ok = /firefox.*curl_cffi/i.test(r.stdout ?? "") && !/unavailable/i.test(r.stdout ?? "");
  if (!ok) log("WARN  curl_cffi non disponibile: SoundCloud potrebbe rispondere 403");
  impersonate = ok ? ["--impersonate", "firefox"] : [];
  return impersonate;
}

export function checkTools(): string[] {
  const missing = [];
  for (const cmd of ["yt-dlp", "ffmpeg"]) {
    if (spawnSync(cmd, ["--version"]).error) missing.push(cmd);
  }
  return missing;
}

export const hasImpersonation = () => impersonateArgs().length > 0;

interface RunOptions {
  onLine?: (line: string) => void;
  /** presentarsi come browser: serve per SoundCloud, non per YouTube */
  impersonate?: boolean;
}

/** Lancia yt-dlp. Restituisce lo stdout; in caso di errore lancia l'ultima riga ERROR. */
function run(args: string[], { onLine, impersonate = true }: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", [...(impersonate ? impersonateArgs() : []), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    running.add(child);
    let stdout = "";
    let lastError: string | null = null;
    const out = createInterface({ input: child.stdout });
    out.on("line", (line) => {
      if (onLine) onLine(line);
      else stdout += line + "\n";
    });
    createInterface({ input: child.stderr }).on("line", (line) => {
      if (line.startsWith("ERROR:")) lastError = line;
      log(line.startsWith("ERROR:") || line.startsWith("WARNING:") ? line : `      ${line}`);
    });
    child.on("error", (e) => {
      running.delete(child);
      reject(e);
    });
    child.on("close", (code, signal) => {
      running.delete(child);
      if (code === 0) resolve(stdout);
      else reject(new Error(lastError ?? `yt-dlp terminato (${signal ?? `codice ${code}`})`));
    });
  });
}

interface FlatInfo {
  _type?: string;
  id?: string | number;
  title?: string;
  entries?: { id?: string | number; title?: string; url?: string }[];
}

async function extractFlat(url: string): Promise<FlatInfo> {
  return JSON.parse(await run(["--flat-playlist", "-J", "--no-warnings", url]));
}

export const safeName = (s?: string | null) =>
  (s ?? "").replace(/[/\\\r\n]/g, "_").trim() || "Senza titolo";

/** Le playlist "flat" non hanno i titoli: ne ricaviamo uno leggibile dall'url. */
export function titleFromUrl(url: string): string {
  const api = /api(?:-v2)?\.soundcloud\.com\/tracks\/(\d+)/.exec(url);
  if (api) return `traccia ${api[1]}`;
  const [user, slug] = url.split("soundcloud.com/")[1]?.split("/") ?? [];
  const clean = (s?: string) => decodeURIComponent(s ?? "").replace(/[-_]+/g, " ").trim();
  return slug ? `${clean(user)} - ${clean(slug)}` : clean(user) || url;
}

const tracksOf = (entries: FlatInfo["entries"] = []): Track[] =>
  entries
    .filter((e) => e.url)
    .map((e, i) => ({ id: String(e.id), title: e.title || titleFromUrl(e.url!), url: e.url!, index: i + 1 }));

/**
 * Espande una sorgente in playlist:
 * - pagina /sets di un profilo       -> una voce per playlist (tracce lette dopo)
 * - playlist, album, /tracks, /likes -> una voce con le sue tracce
 * - traccia singola                  -> voce nella cartella "Tracce singole"
 */
export async function resolveSource(url: string): Promise<Playlist[]> {
  const info = await extractFlat(url);
  if (info._type !== "playlist" && info._type !== "multi_video") {
    return [{ name: SINGLES, url: null, tracks: [{ id: String(info.id), title: info.title || url, url, index: 1 }] }];
  }
  const entries = (info.entries ?? []).filter((e) => e.url);
  if (entries.length && entries.every((e) => e.url!.includes("/sets/"))) {
    return entries.map((e) => ({ name: safeName(e.title), url: e.url!, tracks: null }));
  }
  return [{ name: safeName(info.title), url: null, tracks: tracksOf(entries) }];
}

export async function listTracks(url: string): Promise<Track[]> {
  return tracksOf((await extractFlat(url)).entries);
}

export interface TrackInfo {
  id: string;
  title: string;
  uploader: string | null;
  artist: string | null;
  track: string | null;
  album: string | null;
  genre: string | null;
  date: string | null; // YYYYMMDD
  duration: number | null;
  thumbnail: string | null;
  url: string;
}

type RawInfo = Record<string, any>;

const toInfo = (d: RawInfo, url: string): TrackInfo => ({
  id: String(d.id),
  title: d.title ?? url,
  uploader: d.uploader ?? null,
  artist: d.artist ?? null,
  track: d.track ?? null,
  album: d.album ?? null,
  genre: d.genre ?? null,
  date: d.upload_date ?? null,
  duration: d.duration ?? null,
  thumbnail: d.thumbnail ?? null,
  url: d.webpage_url ?? url,
});

/** Dati completi di una traccia, anche se non è scaricabile (DRM, Go+). */
export async function trackInfo(url: string): Promise<TrackInfo> {
  return toInfo(JSON.parse(await run(["-J", "--ignore-no-formats-error", "--no-warnings", url])), url);
}

/**
 * Come trackInfo, ma per tante tracce con un solo processo yt-dlp. Le tracce che non si
 * riescono a leggere mancano semplicemente dal risultato (id -> dati).
 */
export async function trackInfos(urls: string[]): Promise<Map<string, TrackInfo>> {
  const out = new Map<string, TrackInfo>();
  const args = ["-j", "--ignore-no-formats-error", "--ignore-errors", "--no-warnings", ...urls];
  const collect = (line: string) => {
    if (!line.startsWith("{")) return;
    const info = toInfo(JSON.parse(line), "");
    out.set(info.id, info);
  };
  try {
    await run(args, { onLine: collect });
  } catch {
    // con --ignore-errors l'uscita è "errore" se anche una sola traccia fallisce: va bene così
  }
  return out;
}

export interface SearchResult {
  id: string;
  title: string;
  channel: string | null;
  duration: number | null;
  url: string;
}

type RawEntry = { id: string | number; title?: string; channel?: string; uploader?: string; duration?: number; url?: string };

/** Risultati di una ricerca di yt-dlp ("ytsearch8:...", "scsearch8:..." o un url di ricerca). */
async function search(target: string, impersonate: boolean, extra: string[] = []): Promise<SearchResult[]> {
  const d = JSON.parse(await run(["--flat-playlist", "-J", "--no-warnings", ...extra, target], { impersonate }));
  return ((d.entries ?? []) as RawEntry[])
    .filter((e) => e.url)
    .map((e) => ({
      id: String(e.id),
      title: e.title ?? "",
      channel: e.channel ?? e.uploader ?? null,
      duration: e.duration ?? null,
      url: e.url!,
    }));
}

export const searchYouTube = (query: string, count = 8) => search(`ytsearch${count}:${query}`, false);

/** Altri caricamenti dello stesso brano su SoundCloud (spesso dell'etichetta o dell'artista). */
export const searchSoundCloud = (query: string, count = 8) => search(`scsearch${count}:${query}`, true);

/** Solo i brani (audio ufficiale, canali "Topic"): titoli senza artista né durata, vedi details. */
export const searchYouTubeMusic = (query: string, count = 8) =>
  search(`https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`, false, ["-I", `1:${count}`]);

/** Durata e artista di un singolo risultato, per le ricerche che non li danno. */
export async function details(url: string, impersonate: boolean): Promise<SearchResult> {
  const d = JSON.parse(await run(["-J", "--skip-download", "--no-warnings", url], { impersonate }));
  const artists: string[] | undefined = d.artists ?? (d.artist ? [d.artist] : undefined);
  return {
    id: String(d.id),
    title: d.title ?? "",
    channel: artists?.join(", ") ?? d.channel ?? d.uploader ?? null,
    duration: d.duration ?? null,
    url: d.webpage_url ?? url,
  };
}

/** Nome di file come lo farebbe yt-dlp col modello "%(uploader)s - %(title)s [%(id)s]". */
export function fileBase(info: Pick<TrackInfo, "id" | "title" | "uploader">): string {
  const clean = (s: string | null) => (s ?? "NA").replaceAll("/", "⧸").replace(/[\r\n]/g, " ").trim();
  return `${clean(info.uploader)} - ${clean(info.title)} [${info.id}]`;
}

export function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  url = url.replace(/^https?:\/\/(m\.|www\.)?soundcloud\.com/, "https://soundcloud.com");
  return url.split("?")[0].replace(/\/+$/, "");
}

export function isProfile(url: string): boolean {
  const path = url.split("soundcloud.com/")[1] ?? "";
  return path.length > 0 && !path.includes("/");
}

const PP_LABELS: Record<string, string> = {
  ExtractAudio: "converto in mp3",
  ThumbnailsConvertor: "copertina",
  Metadata: "metadati",
  EmbedThumbnail: "inserisco copertina",
};

const PROGRESS =
  "download:PROG %(progress.downloaded_bytes)s %(progress.total_bytes)s " +
  "%(progress.total_bytes_estimate)s %(progress.speed)s " +
  "%(progress.fragment_index)s %(progress.fragment_count)s";

const num = (s: string | undefined) => {
  const n = Number(s);
  return s && s !== "NA" && Number.isFinite(n) ? n : null;
};

/** Parsing di una riga di output di yt-dlp in uno stato da mostrare (o null se irrilevante). */
export function parseLine(line: string): Status | null {
  if (line.startsWith("PROG ")) {
    const [done, total, estimate, speed, frag, frags] = line.slice(5).split(" ").map(num);
    const size = total ?? estimate;
    const percent =
      size && done != null ? (done / size) * 100 : frag != null && frags ? (frag / frags) * 100 : undefined;
    return {
      text: speed ? `${(speed / 1e6).toFixed(1)} MB/s` : "scarico",
      percent,
      speed: speed ?? 0,
      bytes: done ?? undefined,
    };
  }
  const dest = /^\[download\] Destination: (.+)$/.exec(line)?.[1];
  if (dest) {
    const name = basename(dest);
    return { text: "scarico", title: name.slice(0, name.lastIndexOf(" [")) || name };
  }
  const pp = /^\[(\w+)\]/.exec(line)?.[1];
  if (pp && PP_LABELS[pp]) return { text: PP_LABELS[pp], percent: 100, speed: 0 };
  return null;
}

interface DownloadOptions {
  /** nome del file senza estensione (predefinito: "Uploader - Titolo [id]" di yt-dlp) */
  name?: string;
  impersonate?: boolean;
}

/**
 * Il filtro sul formato scarta le anteprime delle tracce Go+ (`http_mp3_1_0_preview`):
 * sono 30 secondi, ma yt-dlp le scaricherebbe senza un errore e finirebbero in libreria
 * come se fossero il brano intero. Escluse, yt-dlp risponde "Requested format is not
 * available" e la traccia conta come fallita, così la si cerca altrove.
 */
export function downloadArgs(url: string, folder: string, name?: string): string[] {
  const output = name ? `${name.replaceAll("%", "%%")}.%(ext)s` : "%(uploader)s - %(title)s [%(id)s].%(ext)s";
  return [
    "--newline",
    "--no-overwrites",
    "-f", "bestaudio[format_id!*=preview]/best[format_id!*=preview]",
    "-x", "--audio-format", "mp3", "--audio-quality", "0",
    "--convert-thumbnails", "jpg", "--embed-thumbnail", "--embed-metadata",
    "--progress-template", PROGRESS,
    "-o", join(folder, output),
    url,
  ];
}

export async function download(
  url: string,
  folder: string,
  onStatus: (s: Status) => void,
  { name, impersonate = true }: DownloadOptions = {},
) {
  await run(
    downloadArgs(url, folder, name),
    {
      impersonate,
      onLine: (line) => {
        const s = parseLine(line);
        if (s) onStatus(s);
        if (!line.startsWith("PROG ")) log(`      ${line}`);
      },
    },
  );
}
