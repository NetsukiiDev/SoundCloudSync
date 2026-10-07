// Impostazioni salvate in ~/.config/soundcloud-sync/config.json.
// I percorsi sono funzioni e non costanti: leggono HOME ogni volta (i test la cambiano).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PRUNE_MODES = {
  chiedi: "chiedi ogni volta, poi nel cestino",
  cestino: "nel cestino senza chiedere",
  elimina: "elimina definitivamente senza chiedere",
  mai: "non rimuovere mai",
} as const;

export type PruneMode = keyof typeof PRUNE_MODES;

/** Ogni quante ore la sync automatica (0 = mai). Divisori di 24, per orari regolari. */
export const AUTOSYNC_HOURS = [0, 1, 2, 3, 4, 6, 8, 12, 24] as const;

export interface Config {
  folder: string;
  sources: string[];
  jobs: number;
  prune: PruneMode;
  /** sync automatica poco dopo l'accesso al PC */
  autostart: boolean;
  /** sync automatica ogni N ore (0 = disattivata) */
  autosync: number;
  /** cerca altrove (vedi fallback.ts) le tracce non scaricabili da SoundCloud */
  fallback: boolean;
}

export class ConfigError extends Error {}

export const configPath = () => join(homedir(), ".config", "soundcloud-sync", "config.json");
export const cacheDir = () => join(homedir(), ".cache", "soundcloud-sync");
export const logPath = () => join(cacheDir(), "last-run.log");

export function defaults(): Config {
  return {
    folder: join(homedir(), "Musica", "SoundCloud"),
    sources: ["https://soundcloud.com/k_h0le/sets"],
    jobs: 6,
    prune: "chiedi",
    autostart: false,
    autosync: 0,
    fallback: true,
  };
}

export function load(): Config {
  const cfg = defaults();
  const path = configPath();
  if (existsSync(path)) {
    try {
      Object.assign(cfg, JSON.parse(readFileSync(path, "utf8")));
    } catch (e) {
      throw new ConfigError(`${path} non è un JSON valido: ${(e as Error).message}`);
    }
  }
  if (!(cfg.prune in PRUNE_MODES)) cfg.prune = "chiedi";
  cfg.jobs = Math.max(1, Math.min(12, Math.trunc(Number(cfg.jobs)) || 6));
  cfg.autostart = cfg.autostart === true;
  cfg.fallback = cfg.fallback !== false;
  if (!(AUTOSYNC_HOURS as readonly number[]).includes(cfg.autosync)) cfg.autosync = 0;
  return cfg;
}

export function save(cfg: Config): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
}

export const expandHome = (p: string) =>
  p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;

export function prettyPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}
