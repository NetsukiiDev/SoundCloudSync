#!/usr/bin/env node
// Punto d'ingresso del comando soundcloud-sync.

import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import chalk from "chalk";
import { ConfigError, configPath, load, save } from "./config.ts";
import { menu } from "./menu.ts";
import { notify } from "./notify.ts";
import { run } from "./sync.ts";
import { killAll } from "./ytdlp.ts";

const HELP = `Uso: soundcloud-sync [sync [--notify]]

Sincronizza profili e playlist SoundCloud in cartelle locali di mp3.

  (nessun argomento)  apre il menu
  sync                sincronizza subito, senza menu
  --notify            a fine sync manda una notifica desktop (usato dalla sync automatica)
  -h, --help          questo aiuto
  -v, --version       versione`;

function interrupted(): never {
  killAll();
  process.stdout.write("\x1b[?25h"); // ripristina il cursore
  console.log(chalk.yellow("\nInterrotto."));
  process.exit(130);
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      notify: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    console.log(`soundcloud-sync ${pkg.version}`);
    return 0;
  }
  if (positionals.length && positionals[0] !== "sync") {
    console.error(`Comando sconosciuto: ${positionals[0]}\n\n${HELP}`);
    return 2;
  }

  let cfg;
  try {
    cfg = load();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(chalk.red(`✗ ${e.message}`));
      return 1;
    }
    throw e;
  }
  if (!existsSync(configPath())) save(cfg);

  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted); // systemctl stop sulla sync automatica
  const interactive = Boolean(process.stdin.isTTY);
  if (positionals[0] === "sync" || !interactive) {
    const result = await run(cfg, { interactive, confirm: async () => false });
    if (values.notify) notify(result);
    return result.code;
  }
  try {
    return await menu(cfg);
  } catch (e) {
    if ((e as Error).name === "ExitPromptError") interrupted(); // Ctrl+C dentro un prompt
    throw e;
  }
}

process.exitCode = await main();
