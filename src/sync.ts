// Una sincronizzazione completa: lettura, download, pulizia, riepilogo.

import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import chalk from "chalk";
import { cacheDir, type Config, expandHome, logPath, type PruneMode } from "./config.ts";
import { explain } from "./errors.ts";
import {
  existingIds,
  findRemoved,
  linkOrCopy,
  localTrackCount,
  mp3WithId,
  trash,
  trashDir,
} from "./library.ts";
import { log, resetLog } from "./log.ts";
import * as ui from "./ui.ts";
import { pool } from "./pool.ts";
import { tagAll } from "./tagger.ts";
import { TransferView } from "./view.ts";
import { failure, findAndDownload, type FoundTrack, type Miss, untried } from "./fallback.ts";
import * as unavailable from "./unavailable.ts";
import * as yt from "./ytdlp.ts";

// Se una pulizia toglierebbe più di metà delle tracce di una cartella (e almeno questo numero)
// probabilmente SoundCloud ha risposto male: si chiede sempre conferma.
export const SUSPICIOUS_MIN = 5;

export interface Job {
  folder: string;
  id: string;
  title: string;
  url: string;
  /** posizione nella playlist, da 1 */
  index: number;
}

export interface Stats {
  tot: number;
  added: number;
  failed: number;
  removed: number;
  /** saltate perché non scaricabili (vedi unavailable.ts) */
  unavailable: number;
  err: boolean;
}

export interface Scan {
  jobs: Job[];
  stats: Map<string, Stats>;
  expected: Map<string, Set<string>>;
}

export interface Failure {
  job: Job;
  permanent: boolean;
  playlist: string;
  reason: string | null;
  raw: string;
}

export const newStats = (): Stats => ({ tot: 0, added: 0, failed: 0, removed: 0, unavailable: 0, err: false });

async function scanAll(sources: string[], base: string, jobsN: number): Promise<Scan> {
  const playlists: yt.Playlist[] = [];
  const sourceErrors: [string, unknown][] = [];
  await ui.withSpinner(chalk.bold("Leggo profili e playlist..."), () =>
    pool(sources, jobsN, yt.resolveSource, (url, r) => {
      if (r.status === "fulfilled") playlists.push(...r.value);
      else {
        sourceErrors.push([url, r.reason]);
        log(`ERROR sorgente ${url}: ${(r.reason as Error).message}`);
      }
    }),
  );
  ui.ok(`${playlists.length} playlist da ${sources.length} sorgenti`);
  for (const [url, err] of sourceErrors) {
    const { reason, raw } = explain(err);
    ui.fail(`${url}: ${reason ?? raw}`);
  }

  const scan: Scan = { jobs: [], stats: new Map(), expected: new Map() };
  let done = 0;
  const label = () =>
    `Leggo le tracce delle playlist ${ui.bar((done / (playlists.length || 1)) * 100, 30)} ${done}/${playlists.length}`;
  await ui.withSpinner(label, () =>
    pool(
      playlists,
      jobsN,
      async (pl) => pl.tracks ?? (await yt.listTracks(pl.url!)),
      (pl, r) => {
        done++;
        const s = scan.stats.get(pl.name) ?? newStats();
        scan.stats.set(pl.name, s);
        if (r.status === "rejected") {
          s.err = true;
          log(`ERROR playlist ${pl.url}: ${(r.reason as Error).message}`);
          return;
        }
        s.tot += r.value.length;
        const expected = scan.expected.get(pl.name) ?? new Set();
        scan.expected.set(pl.name, expected);
        for (const t of r.value) {
          expected.add(t.id);
          scan.jobs.push({ folder: join(base, pl.name), ...t });
        }
      },
    ),
  );
  return scan;
}

/**
 * Decide cosa scaricare. Le tracce già presenti altrove vengono collegate, non riscaricate.
 * `extra` mappa id -> altre cartelle in cui la stessa traccia deve comparire.
 */
export function plan(jobs: Job[], base: string) {
  const have = existingIds(base);
  const todo: Job[] = [];
  const extra = new Map<string, string[]>();
  const seen = new Set<string>();
  let linked = 0;
  for (const job of jobs) {
    if (mp3WithId(job.folder, job.id)) continue;
    const existing = have.get(job.id);
    if (existing) {
      mkdirSync(job.folder, { recursive: true });
      linkOrCopy(existing, join(job.folder, basename(existing)));
      linked++;
    } else if (seen.has(job.id)) {
      extra.set(job.id, [...(extra.get(job.id) ?? []), job.folder]);
    } else {
      seen.add(job.id);
      todo.push(job);
    }
  }
  return { todo, extra, linked };
}

/** Collega l'mp3 appena scaricato nelle altre playlist che contengono la stessa traccia. */
function linkExtra(job: Job, extra: Map<string, string[]>): void {
  const mp3 = mp3WithId(job.folder, job.id);
  if (!mp3) throw new Error("ERROR: mp3 non trovato dopo il download (postprocess)");
  for (const other of extra.get(job.id) ?? []) {
    mkdirSync(other, { recursive: true });
    linkOrCopy(mp3, join(other, basename(mp3)));
  }
}

const jobLabel = (job: Job) => `${ui.dim(`${ui.truncate(basename(job.folder), 18)} /`)} ${job.title}`;

async function downloadAll(
  todo: Job[],
  extra: Map<string, string[]>,
  stats: Map<string, Stats>,
  jobsN: number,
): Promise<Failure[]> {
  const failures: Failure[] = [];
  const view = new TransferView<Job>(`In download (max ${jobsN})`, todo.length).start();
  try {
    await pool(
      todo,
      jobsN,
      async (job) => {
        view.add(job, jobLabel(job));
        try {
          mkdirSync(job.folder, { recursive: true });
          await yt.download(job.url, job.folder, (s) => {
            if (s.title) {
              job.title = s.title;
              view.label(job, jobLabel(job));
            }
            view.update(job, s);
          });
          linkExtra(job, extra);
        } finally {
          view.remove(job);
        }
      },
      (job, r) => {
        view.done(r.status === "fulfilled");
        const names = [job.folder, ...(extra.get(job.id) ?? [])].map((f) => basename(f));
        if (r.status === "fulfilled") {
          for (const n of names) stats.get(n)!.added++;
        } else {
          for (const n of names) stats.get(n)!.failed++;
          const { reason, raw, permanent } = explain(r.reason);
          failures.push({ job, permanent, playlist: basename(job.folder), reason, raw });
          log(`ERROR ${job.url}: ${(r.reason as Error).message}`);
        }
      },
    );
  } finally {
    view.stop();
  }
  return failures;
}

interface Found {
  job: Job;
  track: FoundTrack;
}

/**
 * Cerca altrove le tracce non scaricabili da SoundCloud. `others` mappa id -> altre
 * cartelle in cui collegare il file trovato, `tried` id -> fonti già provate in passato.
 * Restituisce id -> trovata | motivo del fallimento.
 */
async function fallbackAll(
  lookups: Job[],
  others: Map<string, string[]>,
  tried: Map<string, string[]>,
  jobsN: number,
): Promise<Map<string, FoundTrack | Miss>> {
  const outcome = new Map<string, FoundTrack | Miss>();
  if (!lookups.length) return outcome;
  ui.print();
  ui.ok(`Cerco altrove ${lookups.length} ${lookups.length === 1 ? "traccia non scaricabile" : "tracce non scaricabili"} da SoundCloud`);
  // YouTube e SoundCloud limitano in fretta chi fa troppe richieste insieme.
  const parallel = Math.min(jobsN, 3);
  const view = new TransferView<Job>(`Ricerca altrove (max ${parallel})`, lookups.length).start();
  try {
    await pool(
      lookups,
      parallel,
      async (job) => {
        view.add(job, jobLabel(job));
        try {
          mkdirSync(job.folder, { recursive: true });
          const onStatus = (s: yt.Status) => {
            if (s.title) view.label(job, `${ui.dim(`${ui.truncate(basename(job.folder), 18)} /`)} ${s.title}`);
            view.update(job, s);
          };
          const track = await findAndDownload(job.url, job.folder, onStatus, tried.get(job.id));
          linkExtra(job, others);
          return track;
        } finally {
          view.remove(job);
        }
      },
      (job, r) => {
        view.done(r.status === "fulfilled");
        if (r.status === "fulfilled") outcome.set(job.id, r.value);
        else {
          outcome.set(job.id, failure(r.reason));
          log(`ERROR ricerca ${job.url}: ${(r.reason as Error).message}`);
        }
      },
    );
  } finally {
    view.stop();
  }
  return outcome;
}

const displayTitle = (files: string[]) => {
  const f = basename(files.find((p) => p.endsWith(".mp3")) ?? files[0]);
  return f.includes(" [") ? f.slice(0, f.lastIndexOf(" [")) : f;
};

export interface PruneOptions {
  interactive: boolean;
  confirm: (message: string) => Promise<boolean>;
}

/**
 * Toglie le tracce che non sono più nelle playlist su SoundCloud.
 * Tocca solo le cartelle delle playlist lette correttamente in questa sync.
 */
/** Restituisce quante tracce sparite sono rimaste in attesa di conferma. */
export async function prune(scan: Scan, base: string, mode: PruneMode, opts: PruneOptions): Promise<number> {
  if (mode === "mai") return 0;
  const candidates = new Map<string, Map<string, string[]>>();
  const suspicious = new Set<string>();
  for (const [name, s] of scan.stats) {
    if (s.err) continue;
    const folder = join(base, name);
    const removed = findRemoved(folder, scan.expected.get(name) ?? new Set());
    if (!removed.size) continue;
    candidates.set(name, removed);
    if (removed.size >= SUSPICIOUS_MIN && removed.size > localTrackCount(folder) / 2) suspicious.add(name);
  }
  if (!candidates.size) return 0;

  const total = [...candidates.values()].reduce((a, m) => a + m.size, 0);
  const t = ui.table(["Playlist", "Traccia"], { title: chalk.yellow(`Non più su SoundCloud (${total})`), color: chalk.yellow });
  for (const [name, removed] of [...candidates].sort()) {
    for (const files of removed.values()) {
      t.push([name + (suspicious.has(name) ? chalk.red(" (sospetto)") : ""), displayTitle(files)]);
    }
  }
  ui.print(t.toString());
  if (suspicious.size) {
    ui.print(chalk.red("⚠ In alcune playlist sparirebbe più di metà delle tracce: potrebbe essere un errore di SoundCloud."));
  }

  const permanent = mode === "elimina";
  if (mode === "chiedi" || suspicious.size) {
    if (!opts.interactive) {
      ui.print(ui.dim("Non rimosse: avvia il programma dal menu per confermare."));
      return total;
    }
    const action = permanent ? "Eliminarle definitivamente?" : "Spostarle nel cestino?";
    if (!(await opts.confirm(action))) {
      ui.print(ui.dim("Lasciate dove sono."));
      return total;
    }
  }

  for (const [name, removed] of candidates) {
    for (const files of removed.values()) {
      for (const f of files) {
        try {
          if (permanent) unlinkSync(f);
          else trash(f);
        } catch (e) {
          log(`ERROR rimozione ${f}: ${(e as Error).message}`);
        }
      }
      scan.stats.get(name)!.removed++;
    }
  }
  ui.ok(`${total} tracce ${permanent ? "eliminate" : `nel cestino ${ui.dim(`(${trashDir()})`)}`}`);
  return 0;
}

function reportFound(found: Found[]): void {
  if (!found.length) return;
  const w = ui.width();
  const left = Math.floor((w - 7) * 0.45);
  const t = ui.table(["Traccia SoundCloud", "Scaricata da"], {
    title: chalk.cyan(`Trovate altrove (${found.length})`),
    color: chalk.cyan,
    colWidths: [left, w - 7 - left],
  });
  for (const { job, track } of found) {
    const { info, match, score, source } = track;
    t.push([
      `${ui.dim(basename(job.folder) + " /")} ${info.artist ?? info.uploader} - ${info.track ?? info.title}`,
      `${match.title} ${ui.dim(`· ${source} · ${match.channel ?? "?"} · corrispondenza ${Math.round(score * 100)}%`)}\n${ui.dim(match.url)}`,
    ]);
  }
  ui.print(t.toString());
}

function report(stats: Map<string, Stats>, failures: Failure[]): void {
  const t = ui.table(["Playlist", "Tracce", "Nuove", "Rimosse", "Fallite", "Non disp."], {
    title: "Riepilogo",
    align: ["left", "right", "right", "right", "right", "right"],
  });
  const n = (v: number, color: (s: string) => string) => (v ? color(String(v)) : "");
  for (const [name, s] of [...stats].sort(([a], [b]) => a.localeCompare(b, "it", { sensitivity: "base" }))) {
    if (s.err) t.push([name, "-", "-", "-", chalk.red("non leggibile"), "-"]);
    else {
      t.push([
        name,
        String(s.tot),
        n(s.added, chalk.green),
        n(s.removed, chalk.yellow),
        n(s.failed, chalk.red),
        n(s.unavailable, ui.dim),
      ]);
    }
  }
  ui.print(t.toString());
  const skipped = [...stats.values()].reduce((a, s) => a + s.unavailable, 0);
  if (skipped) {
    ui.print(
      ui.dim(
        `${skipped} tracce non disponibili (DRM, Go+, rimosse) saltate: ` +
          `si riprovano dopo ${unavailable.RETRY_DAYS} giorni.`,
      ),
    );
  }

  if (!failures.length) {
    ui.print(chalk.bold.green("Sync completata."));
    return;
  }
  const w = ui.width();
  const left = Math.floor((w - 7) * 0.4);
  const ft = ui.table(["Traccia", "Motivo"], {
    title: chalk.red(`Tracce fallite (${failures.length})`),
    color: chalk.red,
    colWidths: [left, w - 7 - left],
  });
  failures.sort((a, b) => (a.playlist + a.job.title).localeCompare(b.playlist + b.job.title));
  for (const f of failures) {
    ft.push([
      `${ui.dim(f.playlist + " /")} ${f.job.title}\n${ui.dim(f.job.url)}`,
      f.reason ? `${chalk.bold(f.reason)}\n${ui.dim(f.raw)}` : f.raw,
    ]);
  }
  ui.print(ft.toString());
  ui.print(ui.dim(`Log completo: ${logPath()}`));
}

/**
 * Le playlist lette "flat" spesso non danno i titoli ("traccia 123"), e le tracce Go+ o DRM
 * falliscono prima che yt-dlp li legga: per il registro si chiedono a SoundCloud, una volta.
 * Restituisce quanti titoli ha aggiunto.
 */
export async function fillTitles(entries: Map<string, unavailable.Entry>): Promise<number> {
  const missing = [...entries].filter(([id, e]) => !e.title || e.title === `traccia ${id}`).map(([id]) => id);
  if (!missing.length) return 0;
  const infos = await yt.trackInfos(missing.map((id) => `https://api.soundcloud.com/tracks/${id}`));
  for (const [id, info] of infos) {
    const e = entries.get(id);
    if (e) e.title = `${info.artist ?? info.uploader ?? "?"} - ${info.track ?? info.title}`;
  }
  return infos.size;
}

export interface Result {
  code: number;
  added: number;
  failed: number;
  removed: number;
  /** tracce sparite da SoundCloud in attesa di conferma */
  pending: number;
  /** tracce non scaricabili da SoundCloud trovate e scaricate altrove */
  alt: number;
  /** errore che ha fermato la sync prima dei download */
  error?: string;
  /** un'altra sync era già in corso */
  busy?: boolean;
}

const lockPath = () => join(cacheDir(), "sync.lock");

/** Impedisce due sync contemporanee (es. menu + timer automatico). */
function acquireLock(): boolean {
  mkdirSync(cacheDir(), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath(), String(process.pid), { flag: "wx" });
      process.on("exit", releaseLock);
      return true;
    } catch {
      const pid = Number(readFileSync(lockPath(), "utf8"));
      try {
        if (pid && pid !== process.pid) {
          process.kill(pid, 0); // esiste ancora: sync davvero in corso
          return false;
        }
      } catch {
        // processo morto: blocco abbandonato
      }
      rmSync(lockPath(), { force: true });
    }
  }
  return false;
}

function releaseLock(): void {
  try {
    if (readFileSync(lockPath(), "utf8") === String(process.pid)) rmSync(lockPath());
  } catch {
    // già rimosso
  }
}

export async function run(cfg: Config, opts: PruneOptions): Promise<Result> {
  const result: Result = { code: 1, added: 0, failed: 0, removed: 0, pending: 0, alt: 0 };
  const stop = (error: string) => {
    ui.fail(error);
    return { ...result, error };
  };
  if (!acquireLock()) {
    ui.warn("Un'altra sync è già in corso (forse quella automatica): riprova quando finisce.");
    return { ...result, busy: true };
  }
  try {
    if (!cfg.sources.length) return stop("Nessun profilo o playlist da sincronizzare: aggiungine dal menu.");
    const missing = yt.checkTools();
    if (missing.length) return stop(`Mancano dei programmi: ${missing.join(", ")} (pacman -S ${missing.join(" ")})`);
    return await runLocked(cfg, opts, result, stop);
  } finally {
    releaseLock();
  }
}

async function runLocked(
  cfg: Config,
  opts: PruneOptions,
  result: Result,
  stop: (error: string) => Result,
): Promise<Result> {
  const base = expandHome(cfg.folder);
  mkdirSync(base, { recursive: true });
  resetLog();
  if (!yt.hasImpersonation()) {
    ui.warn("python-curl_cffi non installato: SoundCloud potrebbe bloccare (pacman -S python-curl_cffi)");
  }

  ui.print(ui.dim(`Cartella: ${ui.truncate(base, ui.width() - 10)}`));
  const scan = await scanAll(cfg.sources, base, cfg.jobs);
  if (![...scan.stats.values()].some((s) => !s.err)) {
    return stop(`Nessuna playlist leggibile. Dettagli: ${logPath()}`);
  }

  // Le tracce note come non scaricabili non si riprovano su SoundCloud (per un po'):
  // vanno direttamente alla ricerca altrove, se ci sono fonti non ancora provate.
  // Gli errori temporanei della sync precedente si riprovano comunque: si riscrivono alla fine.
  const blocked = new Map([...unavailable.load()].filter(([, e]) => !e.temporary));
  const retry: Job[] = [];
  const jobs = scan.jobs.filter((job) => {
    const entry = blocked.get(job.id);
    if (!entry || mp3WithId(job.folder, job.id)) return true;
    // titolo e playlist, per mostrarla dal menu (le voci vecchie non li hanno)
    entry.title ??= job.title;
    entry.playlists = [...new Set([...(entry.playlists ?? []), basename(job.folder)])];
    if (cfg.fallback && untried(entry.tried).length) retry.push(job);
    else scan.stats.get(basename(job.folder))!.unavailable++;
    return false;
  });
  const { todo, extra, linked } = plan(jobs, base);
  ui.ok(
    `${scan.jobs.length} tracce totali, ${chalk.bold(todo.length)} da scaricare` +
      (linked ? `, ${linked} copiate da altre cartelle` : "") +
      (scan.jobs.length > jobs.length ? `, ${scan.jobs.length - jobs.length} non disponibili saltate` : ""),
  );
  let failures = todo.length ? await downloadAll(todo, extra, scan.stats, cfg.jobs) : [];
  const downloaded = todo.length - failures.length;

  // Ricerca altrove: tracce fallite ora per motivi permanenti + tracce bloccate mai cercate.
  // Una sola ricerca per traccia; le altre cartelle che la contengono ricevono un link.
  const lookups: Job[] = [];
  const others = new Map<string, string[]>();
  const add = (job: Job, more: string[]) => {
    if (others.has(job.id)) others.get(job.id)!.push(job.folder, ...more);
    else {
      lookups.push(job);
      others.set(job.id, [...more]);
    }
  };
  if (cfg.fallback) {
    for (const f of failures) if (f.permanent) add(f.job, extra.get(f.job.id) ?? []);
    for (const job of retry) add(job, []);
  }
  const tried = new Map(retry.map((job) => [job.id, blocked.get(job.id)!.tried ?? []]));
  const outcome = await fallbackAll(lookups, others, tried, cfg.jobs);

  // Conti e registro.
  const since = new Date().toISOString();
  const folders = (job: Job) => [job.folder, ...(others.get(job.id) ?? [])].map((f) => basename(f));
  const found: Found[] = [];
  for (const job of lookups) {
    const o = outcome.get(job.id);
    const wasFailure = failures.some((f) => f.job === job);
    if (o && "file" in o) {
      found.push({ job, track: o });
      blocked.delete(job.id);
      for (const n of folders(job)) {
        scan.stats.get(n)!.added++;
        if (wasFailure) scan.stats.get(n)!.failed--;
      }
    } else if (!wasFailure) {
      // già nota come non scaricabile: si ricordano le fonti provate ora senza successo
      const entry = blocked.get(job.id)!;
      blocked.set(job.id, { ...entry, tried: [...new Set([...(entry.tried ?? []), ...(o?.tried ?? [])])] });
      for (const n of folders(job)) scan.stats.get(n)!.unavailable++;
    }
  }
  for (const f of failures) {
    const o = outcome.get(f.job.id);
    if (o && "file" in o) continue;
    if (o) f.reason = `${f.reason ?? f.raw} · ${o.reason}`;
    blocked.set(f.job.id, {
      reason: f.reason ?? f.raw,
      since,
      title: f.job.title,
      playlists: [f.job.folder, ...(extra.get(f.job.id) ?? [])].map((d) => basename(d)),
      ...(f.permanent ? { tried: o?.tried ?? [] } : { temporary: true }),
    });
  }
  failures = failures.filter((f) => !found.some((x) => x.job.id === f.job.id));
  await fillTitles(blocked);
  unavailable.save(blocked);

  const tagged = await tagAll(scan.jobs, cfg.jobs);
  if (tagged) ui.ok(`Tag sistemati su ${tagged} ${tagged === 1 ? "traccia" : "tracce"}`);

  const pending = await prune(scan, base, cfg.prune, opts);
  reportFound(found);
  report(scan.stats, failures);
  return {
    code: failures.length ? 1 : 0,
    added: downloaded + found.length,
    failed: failures.length,
    removed: [...scan.stats.values()].reduce((a, s) => a + s.removed, 0),
    pending,
    alt: found.length,
  };
}
