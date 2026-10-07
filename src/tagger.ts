// Sistema i tag di tutti gli mp3 della libreria (titolo, artista, album, traccia, anno,
// genere, copertina) secondo le regole di tags.ts.
//
// I dati di SoundCloud si leggono una volta sola e restano in ~/.cache/soundcloud-sync/meta.json
// insieme a un'impronta dei tag scritti: alle sync successive si toccano solo i file nuovi o
// cambiati.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { cacheDir } from "./config.ts";
import { mp3WithId } from "./library.ts";
import { log } from "./log.ts";
import { pool } from "./pool.ts";
import { desiredTags, type Placement, type Tags, type TrackMeta } from "./tags.ts";
import * as ui from "./ui.ts";
import * as yt from "./ytdlp.ts";

/** Quante tracce per processo yt-dlp quando si leggono i dati. */
const BATCH = 25;

interface CacheEntry {
  meta: TrackMeta & { thumbnail?: string | null };
  /** impronta dei tag scritti e stato del file in quel momento */
  tagged?: { hash: string; mtimeMs: number; size: number };
}

type Cache = Record<string, CacheEntry>;

const cachePath = () => join(cacheDir(), "meta.json");

function loadCache(): Cache {
  try {
    return JSON.parse(readFileSync(cachePath(), "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Cache): void {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(cachePath(), JSON.stringify(cache));
}

const toMeta = (info: yt.TrackInfo, source?: string | null): CacheEntry["meta"] => ({
  id: info.id,
  title: info.title,
  uploader: info.uploader,
  artist: info.artist,
  track: info.track,
  album: info.album,
  genre: info.genre,
  date: info.date,
  url: info.url,
  thumbnail: info.thumbnail,
  source: source ?? null,
});

/** Salva i dati di una traccia scaricata altrove (così il tag commento ne indica la fonte). */
export function rememberSource(info: yt.TrackInfo, source: string): void {
  const cache = loadCache();
  cache[info.id] = { meta: toMeta(info, source) };
  saveCache(cache);
}

const hashOf = (tags: Tags) => createHash("sha1").update(JSON.stringify(tags)).digest("hex").slice(0, 16);

function exec(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => resolve({ code: -1, out: String(e) }));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

async function hasCover(file: string): Promise<boolean> {
  const r = await exec("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  return r.code === 0 && r.out.trim().length > 0;
}

async function fetchCover(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

/**
 * Riscrive i tag. Il file viene modificato sul posto (stesso inode): le copie collegate
 * nelle altre playlist restano collegate e si aggiornano insieme.
 */
export async function writeTags(file: string, tags: Tags, coverUrl?: string | null): Promise<boolean> {
  const tmp = `${file}.tag.mp3`;
  const cover = `${file}.cover`;
  try {
    const needCover = coverUrl && !(await hasCover(file)) && (await fetchCover(coverUrl, cover));
    const args = ["-v", "error", "-y", "-i", file];
    if (needCover) args.push("-i", cover, "-map", "0:a", "-map", "1:v");
    else args.push("-map", "0:a", "-map", "0:v?");
    args.push("-c", "copy", "-map_metadata", "-1", "-id3v2_version", "3", "-write_id3v1", "1");
    args.push("-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
    for (const [k, v] of Object.entries(tags)) if (v) args.push("-metadata", `${k}=${v}`);
    const r = await exec("ffmpeg", [...args, tmp]);
    if (r.code !== 0) {
      log(`WARN  tag non scritti per ${file}: ${r.out.trim()}`);
      return false;
    }
    copyFileSync(tmp, file); // sovrascrive il contenuto, non sostituisce il file
    return true;
  } finally {
    rmSync(tmp, { force: true });
    rmSync(cover, { force: true });
  }
}

export interface TagJob {
  id: string;
  url: string;
  folder: string;
  index: number;
}

/** Sistema i tag di tutte le tracce presenti. Restituisce quante sono state aggiornate. */
export async function tagAll(jobs: TagJob[], jobsN: number): Promise<number> {
  const cache = loadCache();

  // Un file per traccia (le copie nelle altre playlist sono hard link). L'album è la prima
  // playlist in cui compare, nell'ordine delle sorgenti.
  const items = new Map<string, { file: string; url: string; place: Placement }>();
  for (const job of jobs) {
    if (items.has(job.id)) continue;
    const file = mp3WithId(job.folder, job.id);
    if (file) items.set(job.id, { file, url: job.url, place: { playlist: basename(job.folder), index: job.index } });
  }

  // Dati mancanti: letti a gruppi, più gruppi in parallelo.
  const missing = [...items].filter(([id]) => !cache[id]).map(([, it]) => it.url);
  if (missing.length) {
    const batches = Array.from({ length: Math.ceil(missing.length / BATCH) }, (_, i) =>
      missing.slice(i * BATCH, (i + 1) * BATCH),
    );
    let read = 0;
    await ui.withSpinner(
      () => `Leggo i dati delle tracce ${ui.bar((read / missing.length) * 100, 30)} ${read}/${missing.length}`,
      () =>
        pool(
          batches,
          Math.min(jobsN, 4),
          async (urls) => {
            const infos = await yt.trackInfos(urls);
            for (const info of infos.values()) cache[info.id] = { meta: toMeta(info) };
            read += urls.length;
            saveCache(cache);
          },
          () => {},
        ),
    );
  }

  // Tag da scrivere: solo dove l'impronta o il file sono cambiati.
  const todo = [...items].filter(([id, it]) => {
    const entry = cache[id];
    if (!entry) return false;
    const st = statSync(it.file);
    const t = entry.tagged;
    return !t || t.hash !== hashOf(desiredTags(entry.meta, it.place)) || t.mtimeMs !== st.mtimeMs || t.size !== st.size;
  });
  if (!todo.length) return 0;

  let done = 0;
  let changed = 0;
  await ui.withSpinner(
    () => `Sistemo i tag ${ui.bar((done / todo.length) * 100, 30)} ${done}/${todo.length}`,
    () =>
      pool(
        todo,
        jobsN,
        async ([id, it]) => {
          const entry = cache[id];
          const tags = desiredTags(entry.meta, it.place);
          if (await writeTags(it.file, tags, entry.meta.thumbnail)) {
            const st = statSync(it.file);
            entry.tagged = { hash: hashOf(tags), mtimeMs: st.mtimeMs, size: st.size };
            changed++;
          }
        },
        ([, it], r) => {
          done++;
          if (r.status === "rejected") log(`WARN  tag non scritti per ${it.file}: ${(r.reason as Error).message}`);
        },
      ),
  );
  saveCache(cache);
  return changed;
}
