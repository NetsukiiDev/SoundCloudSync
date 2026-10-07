// Sync automatica tramite un timer systemd utente:
// ~/.config/systemd/user/soundcloud-sync.{service,timer}

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.ts";

const NAME = "soundcloud-sync";
export const unitDir = () => join(homedir(), ".config", "systemd", "user");
const unit = (file: string) => join(unitDir(), file);
const stampPath = () => join(homedir(), ".local", "share", "systemd", "timers", `stamp-${NAME}.timer`);

// Due timer per lo stesso servizio:
// - LOGIN    scatta poco dopo l'accesso. Viene solo abilitato (non avviato): un OnStartupSec
//            avviato a sessione già aperta scatterebbe subito.
// - PERIODIC scatta a orari fissi; non scatta all'attivazione.
const SERVICE = `${NAME}.service`;
const LOGIN = `${NAME}-login.timer`;
const PERIODIC = `${NAME}.timer`;

/** Ritardo dopo l'accesso: lascia il tempo alla rete di collegarsi. */
export const STARTUP_DELAY = "2min";

export const isEnabled = (cfg: Config) => cfg.autostart || cfg.autosync > 0;

const quote = (s: string) => (/[\s"\\]/.test(s) ? `"${s.replace(/(["\\])/g, "\\$1")}"` : s);

export function serviceUnit(): string {
  const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
  return `[Unit]
Description=SoundCloud Sync

[Service]
Type=oneshot
ExecStart=${quote(process.execPath)} ${quote(cli)} sync --notify
Nice=10
IOSchedulingClass=idle
`;
}

export function loginTimerUnit(): string {
  return `[Unit]
Description=SoundCloud Sync all'accesso

[Timer]
OnStartupSec=${STARTUP_DELAY}
Unit=${SERVICE}

[Install]
WantedBy=timers.target
`;
}

export function periodicTimerUnit(hours: number): string {
  const when = hours === 24 ? "*-*-* 12:00:00" : `*-*-* 00/${hours}:00:00`;
  return `[Unit]
Description=SoundCloud Sync periodica

[Timer]
OnCalendar=${when}
# Se il PC era spento all'ora prevista, recupera la sync appena possibile.
Persistent=true
RandomizedDelaySec=1min
Unit=${SERVICE}

[Install]
WantedBy=timers.target
`;
}

function systemctl(...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() || String(r.error ?? "") };
}

/** Scrive il file; true se è cambiato. */
function write(file: string, content: string): boolean {
  const path = unit(file);
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  writeFileSync(path, content);
  return true;
}

function remove(timer: string): void {
  if (existsSync(unit(timer))) systemctl("disable", "--now", timer);
  rmSync(unit(timer), { force: true });
}

/** Allinea i timer systemd alle impostazioni. Restituisce un errore leggibile o null. */
export function apply(cfg: Config): string | null {
  const installed = [SERVICE, LOGIN, PERIODIC].some((f) => existsSync(unit(f)));
  if (!isEnabled(cfg) && !installed) return null; // niente da fare
  mkdirSync(unitDir(), { recursive: true });
  const steps: string[][] = [];

  if (cfg.autostart) {
    write(LOGIN, loginTimerUnit());
    steps.push(["enable", LOGIN]); // solo abilitato: parte dal prossimo accesso
  } else remove(LOGIN);

  if (cfg.autosync > 0) {
    // Attivato da zero: dimentica le esecuzioni passate, altrimenti Persistent=true
    // "recupererebbe" subito una sync vecchia.
    if (!existsSync(unit(PERIODIC))) rmSync(stampPath(), { force: true });
    const changed = write(PERIODIC, periodicTimerUnit(cfg.autosync));
    steps.push(["enable", "--now", PERIODIC]);
    if (changed) steps.push(["restart", PERIODIC]);
  } else remove(PERIODIC);

  if (isEnabled(cfg)) write(SERVICE, serviceUnit());
  else rmSync(unit(SERVICE), { force: true });

  for (const step of [["daemon-reload"], ...steps]) {
    const r = systemctl(...step);
    if (!r.ok) return `systemctl --user ${step.join(" ")}: ${r.out}`;
  }
  return null;
}

/** Data della prossima sync automatica, se il timer è attivo. */
export function nextRun(): Date | null {
  const r = systemctl("show", PERIODIC, "--timestamp=unix", "-p", "NextElapseUSecRealtime", "--value");
  const m = /@(\d+)/.exec(r.out);
  return r.ok && m ? new Date(Number(m[1]) * 1000) : null;
}

/** "oggi 18:00", "domani 06:00", "lun 6 ott 12:00" */
export function formatWhen(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return `oggi ${time}`;
  if (diff === 1) return `domani ${time}`;
  return `${d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

export function describe(cfg: Config): string {
  const parts = [];
  if (cfg.autostart) parts.push("all'accesso");
  if (cfg.autosync === 1) parts.push("ogni ora");
  else if (cfg.autosync === 24) parts.push("ogni giorno");
  else if (cfg.autosync > 0) parts.push(`ogni ${cfg.autosync} ore`);
  return parts.join(", ") || "disattivata";
}
