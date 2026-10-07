// Operazioni sui file della libreria locale.

import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

// "Artista - Titolo [123456].mp3", ma anche gli avanzi come "[123456].m4a.part-Frag3.part"
const ID_FILE = /\[(\d+)\]\.[A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)*$/;

export function trackId(path: string): string | null {
  return ID_FILE.exec(basename(path))?.[1] ?? null;
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

function files(folder: string): string[] {
  if (!isDir(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(folder, e.name))
    .sort();
}

function walk(dir: string): { files: string[]; dirs: string[] } {
  const out = { files: [] as string[], dirs: [] as string[] };
  if (!isDir(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.dirs.push(p);
      const sub = walk(p);
      out.files.push(...sub.files);
      out.dirs.push(...sub.dirs);
    } else if (e.isFile()) out.files.push(p);
  }
  return out;
}

export function mp3WithId(folder: string, id: string): string | null {
  return files(folder).find((p) => p.endsWith(".mp3") && trackId(p) === id) ?? null;
}

/** id traccia -> un mp3 già scaricato (ovunque sotto base). */
export function existingIds(base: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const p of walk(base).files.sort()) {
    const id = p.endsWith(".mp3") ? trackId(p) : null;
    if (id && !found.has(id)) found.set(id, p);
  }
  return found;
}

/** Hard link (nessuno spazio in più); copia se il filesystem non lo permette. */
export function linkOrCopy(src: string, dst: string): void {
  try {
    linkSync(src, dst);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return;
    copyFileSync(src, dst, constants.COPYFILE_EXCL);
  }
}

function move(src: string, dst: string): void {
  try {
    renameSync(src, dst);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    copyFileSync(src, dst, constants.COPYFILE_EXCL);
    unlinkSync(src);
  }
}

/**
 * Sposta il contenuto di src dentro dst unendo le cartelle. I file identici già presenti
 * vengono scartati; quelli diversi con lo stesso nome restano in src e vengono restituiti.
 */
export function mergeMove(src: string, dst: string): string[] {
  const skipped: string[] = [];
  const tree = walk(src);
  for (const f of tree.files.sort()) {
    const target = join(dst, relative(src, f));
    if (existsSync(target)) {
      if (readFileSync(target).equals(readFileSync(f))) unlinkSync(f);
      else skipped.push(f);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    move(f, target);
  }
  for (const d of [...tree.dirs, src].sort((a, b) => b.length - a.length)) {
    if (isDir(d) && readdirSync(d).length === 0) rmdirSync(d);
  }
  return skipped;
}

/**
 * File della cartella che appartengono a tracce non più presenti nella playlist:
 * id -> file (mp3, copertine, download interrotti). I file senza [id] nel nome, cioè
 * quelli aggiunti a mano, non vengono mai considerati.
 */
export function findRemoved(folder: string, expected: Set<string>): Map<string, string[]> {
  const removed = new Map<string, string[]>();
  for (const p of files(folder)) {
    const id = trackId(p);
    if (id && !expected.has(id)) removed.set(id, [...(removed.get(id) ?? []), p]);
  }
  return removed;
}

export function localTrackCount(folder: string): number {
  return new Set(files(folder).filter((p) => p.endsWith(".mp3")).map(trackId).filter(Boolean))
    .size;
}

export function trashDir(): string {
  const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(data, "Trash");
}

/** Sposta un file nel cestino (standard freedesktop, lo vedono i file manager). */
export function trash(path: string): string {
  const filesDir = join(trashDir(), "files");
  const infoDir = join(trashDir(), "info");
  mkdirSync(filesDir, { recursive: true });
  mkdirSync(infoDir, { recursive: true });
  const ext = extname(path);
  const stem = basename(path, ext);
  for (let i = 0; ; i++) {
    const name = i === 0 ? basename(path) : `${stem}.${i}${ext}`;
    const info = join(infoDir, `${name}.trashinfo`);
    let fd: number;
    try {
      fd = openSync(info, "wx"); // creazione esclusiva: riserva il nome
    } catch {
      continue;
    }
    if (existsSync(join(filesDir, name))) {
      closeSync(fd);
      unlinkSync(info);
      continue;
    }
    const date = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp =
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    const encoded = resolve(path).split("/").map(encodeURIComponent).join("/");
    writeSync(fd, `[Trash Info]\nPath=${encoded}\nDeletionDate=${stamp}\n`);
    closeSync(fd);
    const dest = join(filesDir, name);
    move(path, dest);
    return dest;
  }
}
