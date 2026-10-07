import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { describe, formatWhen, loginTimerUnit, periodicTimerUnit, serviceUnit } from "../src/autosync.ts";
import { cacheDir, defaults } from "../src/config.ts";
import { summary } from "../src/notify.ts";
import { run } from "../src/sync.ts";
import { sandbox } from "./helpers.ts";

beforeEach(() => {
  sandbox();
});

const cfg = (autostart: boolean, autosync: number) => ({ ...defaults(), autostart, autosync });

test("timer all'accesso", () => {
  const t = loginTimerUnit();
  assert.match(t, /OnStartupSec=2min/);
  assert.match(t, /Unit=soundcloud-sync\.service/);
});

test("timer periodico: orari fissi e recupero delle sync perse", () => {
  const t = periodicTimerUnit(6);
  assert.match(t, /OnCalendar=\*-\*-\* 00\/6:00:00/);
  assert.match(t, /Persistent=true/);
  assert.doesNotMatch(t, /OnStartupSec|OnActiveSec/);
  assert.match(periodicTimerUnit(24), /OnCalendar=\*-\*-\* 12:00:00/);
});

test("service: lancia questa copia del programma con --notify", () => {
  const s = serviceUnit();
  // Toglie le virgolette e l'escape dei backslash, così il confronto vale anche con i percorsi Windows
  const exec = s.match(/^ExecStart=(.*)$/m)?.[1].replace(/"/g, "").replaceAll("\\\\", "\\");
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  assert.equal(exec, `${process.execPath} ${cli} sync --notify`);
  assert.match(s, /Type=oneshot/);
});

test("descrizione", () => {
  assert.equal(describe(cfg(false, 0)), "disattivata");
  assert.equal(describe(cfg(true, 1)), "all'accesso, ogni ora");
  assert.equal(describe(cfg(false, 24)), "ogni giorno");
});

test("formatWhen", () => {
  const now = new Date(2026, 9, 1, 10, 0);
  assert.equal(formatWhen(new Date(2026, 9, 1, 18, 0), now), "oggi 18:00");
  assert.equal(formatWhen(new Date(2026, 9, 2, 6, 5), now), "domani 06:05");
});

test("notifica solo se c'è qualcosa da dire", () => {
  const base = { code: 0, added: 0, failed: 0, removed: 0, pending: 0, alt: 0 };
  assert.equal(summary(base), null);
  assert.equal(summary({ ...base, busy: true }), null);
  assert.equal(summary({ ...base, added: 1 })!.body, "1 traccia nuova");
  assert.match(summary({ ...base, added: 3, pending: 2 })!.body, /3 tracce nuove\n2 tolte da SoundCloud/);
  assert.equal(summary({ ...base, error: "boh" })!.urgent, true);
  assert.equal(summary({ ...base, added: 4, alt: 2 })!.body, "4 tracce nuove (2 da altre fonti)");
});

test("due sync insieme: la seconda si ferma", async () => {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(join(cacheDir(), "sync.lock"), String(process.ppid)); // processo vivo
  const r = await run({ ...defaults(), folder: join(cacheDir(), "m") }, { interactive: false, confirm: async () => false });
  assert.equal(r.busy, true);
});

test("blocco abbandonato da un processo morto: viene ignorato", async () => {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(join(cacheDir(), "sync.lock"), "999999999");
  const r = await run({ ...defaults(), sources: [] }, { interactive: false, confirm: async () => false });
  assert.notEqual(r.busy, true);
  assert.equal(r.error, "Nessun profilo o playlist da sincronizzare: aggiungine dal menu.");
  assert.ok(!existsSync(join(cacheDir(), "sync.lock")));
});
