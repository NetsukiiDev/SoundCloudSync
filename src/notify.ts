// Notifica desktop a fine sync automatica (nessuno guarda il terminale).

import { spawnSync } from "node:child_process";
import { logPath } from "./config.ts";
import type { Result } from "./sync.ts";

/** Testo della notifica, o null se non c'è niente da dire. */
export function summary(r: Result): { title: string; body: string; urgent: boolean } | null {
  if (r.busy) return null;
  if (r.error) return { title: "SoundCloud Sync: errore", body: r.error, urgent: true };
  const parts = [];
  if (r.added) {
    const alt = r.alt ? ` (${r.alt} da YouTube)` : "";
    parts.push(`${r.added} ${r.added === 1 ? "traccia nuova" : "tracce nuove"}${alt}`);
  }
  if (r.removed) parts.push(`${r.removed} rimoss${r.removed === 1 ? "a" : "e"}`);
  if (r.failed) parts.push(`${r.failed} non scaricat${r.failed === 1 ? "a" : "e"}`);
  if (r.pending) {
    parts.push(`${r.pending} tolt${r.pending === 1 ? "a" : "e"} da SoundCloud: apri il programma per confermare`);
  }
  if (!parts.length) return null;
  const body = parts.join("\n") + (r.failed ? `\nDettagli: ${logPath()}` : "");
  return { title: "SoundCloud Sync", body, urgent: false };
}

export function notify(r: Result): void {
  const s = summary(r);
  if (!s) return;
  spawnSync("notify-send", [
    "--app-name=SoundCloud Sync",
    "--icon=folder-music",
    `--urgency=${s.urgent ? "critical" : "normal"}`,
    s.title,
    s.body,
  ]);
}
