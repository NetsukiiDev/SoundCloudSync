// Log dell'ultima esecuzione: tutto l'output tecnico di yt-dlp finisce qui, non sul terminale.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { cacheDir, logPath } from "./config.ts";

export function resetLog(): void {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(logPath(), "");
}

export function log(msg: string): void {
  const time = new Date().toTimeString().slice(0, 8);
  try {
    appendFileSync(logPath(), `[${time}] ${stripVTControlCharacters(msg)}\n`);
  } catch {
    // il log non deve mai fermare la sync
  }
}
