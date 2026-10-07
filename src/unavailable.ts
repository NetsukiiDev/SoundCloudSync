// Tracce non scaricate. Quelle per motivi permanenti (DRM, Go+, rimosse...) vengono saltate
// per un po', così la sync automatica non le riprova e notifica ogni volta. Quelle per errori
// temporanei (rete, 403) si riprovano a ogni sync: sono qui solo per vederle dal menu.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./config.ts";

export const RETRY_DAYS = 30;
const DAY = 86_400_000;

export interface Entry {
  reason: string;
  since: string; // ISO
  /** fonti alternative già provate senza successo (vedi fallback.ts) */
  tried?: string[];
  /** errore temporaneo dell'ultima sync: non blocca niente */
  temporary?: boolean;
  /** "Artista - Titolo", per mostrarla dal menu */
  title?: string;
  /** cartelle (playlist) che la contengono */
  playlists?: string[];
  /** formato vecchio: true = già cercata su YouTube */
  searched?: boolean;
}

const path = () => join(cacheDir(), "unavailable.json");

/** Formato vecchio: "searched" valeva anche per le ricerche fallite per errore (es. 403). */
function upgrade(e: Entry, searched?: boolean): Entry {
  if (e.tried || !searched || e.reason.includes("ricerca su YouTube fallita")) return e;
  return { ...e, tried: ["YouTube"] };
}

/** id -> motivo, senza le voci scadute (da riprovare). */
export function load(now = Date.now()): Map<string, Entry> {
  if (!existsSync(path())) return new Map();
  try {
    const data = JSON.parse(readFileSync(path(), "utf8")) as Record<string, Entry>;
    return new Map(
      Object.entries(data)
        .filter(([, e]) => now - Date.parse(e.since) < RETRY_DAYS * DAY)
        .map(([id, { searched, ...e }]) => [id, upgrade(e, searched)]),
    );
  } catch {
    return new Map();
  }
}

export function save(map: Map<string, Entry>): void {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(path(), JSON.stringify(Object.fromEntries(map), null, 2) + "\n");
}

/** Toglie delle tracce dal registro: la prossima sync le riprova da capo, su tutte le fonti. */
export function forget(ids: Iterable<string>): void {
  const map = load();
  for (const id of ids) map.delete(id);
  save(map);
}
