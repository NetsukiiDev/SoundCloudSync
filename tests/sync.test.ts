import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import type { PruneMode } from "../src/config.ts";
import { trashDir } from "../src/library.ts";
import { pool } from "../src/pool.ts";
import { newStats, plan, prune, type Scan } from "../src/sync.ts";
import { downloadArgs, parseLine, titleFromUrl } from "../src/ytdlp.ts";
import { sandbox, touch } from "./helpers.ts";

let dir: string;
beforeEach(() => {
  dir = sandbox();
});

function makeScan(playlists: Record<string, string[]>, err: string[] = []): Scan {
  const scan: Scan = { jobs: [], stats: new Map(), expected: new Map() };
  for (const [name, ids] of Object.entries(playlists)) {
    scan.stats.set(name, { ...newStats(), tot: ids.length, err: err.includes(name) });
    if (!err.includes(name)) scan.expected.set(name, new Set(ids));
  }
  return scan;
}

const auto = { interactive: false, confirm: async () => true };
const runPrune = (scan: Scan, mode: PruneMode, opts = auto) => prune(scan, dir, mode, opts);

test("plan collega le tracce già presenti e non scarica due volte", () => {
  touch(join(dir, "Old", "A - T [1].mp3"));
  const job = (folder: string, id: string) => ({ folder: join(dir, folder), id, title: id, url: id, index: 1 });
  const { todo, extra, linked } = plan([job("Acid", "1"), job("Acid", "2"), job("Tekno", "2")], dir);
  assert.equal(linked, 1);
  assert.ok(existsSync(join(dir, "Acid", "A - T [1].mp3")));
  assert.deepEqual(todo.map((j) => j.id), ["2"]);
  assert.deepEqual(extra.get("2"), [join(dir, "Tekno")]);
});

test("cestino: toglie solo ciò che non c'è più", async () => {
  const keep = touch(join(dir, "Acid", "A [1].mp3"));
  const gone = touch(join(dir, "Acid", "B [2].mp3"));
  const scan = makeScan({ Acid: ["1"] });
  await runPrune(scan, "cestino");
  assert.ok(existsSync(keep) && !existsSync(gone));
  assert.ok(existsSync(join(trashDir(), "files", "B [2].mp3")));
  assert.equal(scan.stats.get("Acid")!.removed, 1);
});

test("playlist non leggibile: non si tocca", async () => {
  const f = touch(join(dir, "Acid", "B [2].mp3"));
  await runPrune(makeScan({ Acid: [] }, ["Acid"]), "elimina");
  assert.ok(existsSync(f));
});

test("chiedi senza terminale: non rimuove", async () => {
  const f = touch(join(dir, "Acid", "B [2].mp3"));
  await runPrune(makeScan({ Acid: ["1"] }), "chiedi");
  assert.ok(existsSync(f));
});

test("chiedi con risposta no: non rimuove", async () => {
  const f = touch(join(dir, "Acid", "B [2].mp3"));
  await runPrune(makeScan({ Acid: ["1"] }), "chiedi", { interactive: true, confirm: async () => false });
  assert.ok(existsSync(f));
});

test("sparisce più di metà: serve conferma anche in automatico", async () => {
  const files = Array.from({ length: 10 }, (_, i) => touch(join(dir, "Acid", `T [${i}].mp3`)));
  await runPrune(makeScan({ Acid: ["0"] }), "elimina");
  assert.ok(files.every((f) => existsSync(f)));
});

test("mai", async () => {
  const f = touch(join(dir, "Acid", "B [2].mp3"));
  await runPrune(makeScan({ Acid: ["1"] }), "mai", { interactive: true, confirm: async () => true });
  assert.ok(existsSync(f));
});

test("pool rispetta il limite e raccoglie gli errori", async () => {
  let running = 0;
  let peak = 0;
  const results: string[] = [];
  await pool(
    [1, 2, 3, 4, 5],
    2,
    async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (n === 3) throw new Error("no");
      return n;
    },
    (n, r) => results.push(`${n}:${r.status}`),
  );
  assert.equal(peak, 2);
  assert.ok(results.includes("3:rejected"));
  assert.equal(results.length, 5);
});

test("parseLine legge l'avanzamento di yt-dlp", () => {
  assert.deepEqual(parseLine("PROG 500 1000 NA 2000000 NA NA"), { text: "2.0 MB/s", percent: 50, speed: 2e6, bytes: 500 });
  assert.equal(parseLine("PROG 10 NA NA NA 3 4")!.percent, 75);
  assert.equal(parseLine("[ExtractAudio] Destination: x.mp3")!.text, "converto in mp3");
  assert.equal(parseLine("[info] qualcosa"), null);
  assert.equal(parseLine("[download] Destination: /m/Acid/Arcane - 303 [101] [2287].m4a")!.title, "Arcane - 303 [101]");
});

test("il formato chiesto a yt-dlp scarta le anteprime di 30 secondi", () => {
  const args = downloadArgs("https://api-v2.soundcloud.com/tracks/1669954107", "/m/HPM");
  assert.equal(args[args.indexOf("-f") + 1], "bestaudio[format_id!*=preview]/best[format_id!*=preview]");
});

test("titolo ricavato dall'url", () => {
  assert.equal(titleFromUrl("https://soundcloud.com/thisisarcane/marie-vaunt-303-101"), "thisisarcane - marie vaunt 303 101");
  assert.equal(titleFromUrl("https://api-v2.soundcloud.com/tracks/2157621204"), "traccia 2157621204");
});

test("registro delle tracce non disponibili: scade dopo 30 giorni", async () => {
  const { load, save, RETRY_DAYS } = await import("../src/unavailable.ts");
  const old = new Date(Date.now() - (RETRY_DAYS + 1) * 86_400_000).toISOString();
  save(new Map([
    ["1", { reason: "DRM", since: new Date().toISOString() }],
    ["2", { reason: "DRM", since: old }],
  ]));
  assert.deepEqual([...load().keys()], ["1"]);
});
