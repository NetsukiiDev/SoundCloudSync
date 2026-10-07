// Menu interattivo (frecce + Invio). Ogni schermata ridisegna il terminale da capo.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { checkbox, confirm, input, number, Separator, select } from "@inquirer/prompts";
import chalk from "chalk";
import * as auto from "./autosync.ts";
import {
  AUTOSYNC_HOURS,
  type Config,
  expandHome,
  PRUNE_MODES,
  type PruneMode,
  prettyPath,
  save,
} from "./config.ts";
import { explain } from "./errors.ts";
import { mergeMove } from "./library.ts";
import { fillTitles, run as runSync } from "./sync.ts";
import * as ui from "./ui.ts";
import * as unavailable from "./unavailable.ts";
import * as yt from "./ytdlp.ts";

const theme = { style: { keysHelpTip: () => ui.dim("↑↓ scegli • ⏎ conferma") } };
// La domanda a cui si è già risposto sparisce invece di restare a schermo.
const tidy = { clearPromptOnDone: true };

// Esiti delle azioni, mostrati sotto l'intestazione della schermata successiva.
const notices: string[] = [];
const notify = {
  ok: (s: string) => notices.push(`${chalk.green("✓")} ${s}`),
  warn: (s: string) => notices.push(chalk.yellow(`⚠ ${s}`)),
  fail: (s: string) => notices.push(`${chalk.red("✗")} ${s}`),
};

function autoLine(cfg: Config): string {
  if (!auto.isEnabled(cfg)) return `${ui.dim("Sync automatica:")} disattivata`;
  const next = cfg.autosync > 0 ? auto.nextRun() : null;
  let when = "";
  if (next) when = ui.dim(` · prossima ${auto.formatWhen(next)}`);
  else if (cfg.autosync > 0) when = chalk.red(" · timer non attivo");
  else if (cfg.autostart) when = ui.dim(" · al prossimo accesso");
  return `${ui.dim("Sync automatica:")} ${auto.describe(cfg)}${when}`;
}

function screen(cfg: Config, section?: string): void {
  ui.clearScreen();
  ui.print(
    ui.card([
      chalk.bold("SoundCloud Sync") + (section ? ui.dim(` › ${section}`) : ""),
      `${ui.dim("Cartella:")} ${prettyPath(expandHome(cfg.folder))}`,
      `${ui.dim("Sorgenti:")} ${cfg.sources.length}   ${ui.dim("Download paralleli:")} ${cfg.jobs}`,
      autoLine(cfg),
    ]),
  );
  for (const n of notices.splice(0)) ui.print(n);
  ui.print();
}

async function addSource(cfg: Config): Promise<void> {
  screen(cfg, "Aggiungi");
  const answer = await input({ message: "Link del profilo, playlist o album (vuoto per annullare)" });
  if (!answer.trim()) return;
  let url = yt.normalizeUrl(answer);
  if (!url.includes("soundcloud.com/")) {
    notify.fail("Non è un link SoundCloud.");
    return;
  }

  if (yt.isProfile(url)) {
    const user = url.split("/").pop();
    url += await select(
      {
        theme,
        message: `${chalk.bold(user)} è un profilo. Cosa vuoi sincronizzare?`,
        choices: [
          { name: "Tutte le sue playlist e album", value: "/sets", description: "una cartella per playlist" },
          { name: "Le tracce che ha caricato", value: "/tracks" },
          { name: 'I suoi "mi piace"', value: "/likes" },
        ],
      },
      tidy,
    );
  }
  if (cfg.sources.includes(url)) {
    notify.warn(`${url} è già nella lista.`);
    return;
  }

  let found = "";
  try {
    const items = await ui.withSpinner("Controllo il link...", () => yt.resolveSource(url));
    const names = items.slice(0, 5).map((p) => p.name).join(", ") + (items.length > 5 ? " …" : "");
    found = ` ${ui.dim(`(${items.length} ${items.length === 1 ? "cartella" : "cartelle"}: ${names})`)}`;
  } catch (e) {
    const { reason, raw } = explain(e);
    ui.warn(`Non riesco a leggerlo ora: ${reason ?? raw}`);
    if (!(await confirm({ message: "Aggiungerlo lo stesso?", default: false }, tidy))) return;
  }
  cfg.sources.push(url);
  save(cfg);
  notify.ok(`Aggiunto ${url}${found}`);
}

async function manageSources(cfg: Config): Promise<void> {
  for (;;) {
    screen(cfg, "Profili e playlist");
    const choice = await select<string>(
      {
        theme,
        message: "Profili e playlist sincronizzati",
        pageSize: 15,
        choices: [
          ...cfg.sources.map((s) => ({ name: s, value: `rm:${s}`, description: "Invio per rimuoverlo" })),
          ...(cfg.sources.length ? [] : [new Separator(ui.dim("  (nessuno)"))]),
          { name: chalk.green("+ Aggiungi"), value: "add" },
          { name: "← Indietro", value: "back" },
        ],
      },
      tidy,
    );
    if (choice === "back") return;
    if (choice === "add") await addSource(cfg);
    else if (choice.startsWith("rm:")) {
      const url = choice.slice(3);
      if (await confirm({ message: `Rimuovere ${url}? (i file già scaricati restano)`, default: false }, tidy)) {
        cfg.sources = cfg.sources.filter((s) => s !== url);
        save(cfg);
        notify.ok(`Rimosso ${url}`);
      }
    }
  }
}

async function changeFolder(cfg: Config): Promise<void> {
  screen(cfg, "Cartella");
  const old = resolve(expandHome(cfg.folder));
  const answer = (await input({ message: "Nuova cartella (vuoto per annullare)" }, tidy)).trim();
  if (!answer) return;
  const next = resolve(expandHome(answer));
  if (next === old) return;

  const hasFiles = existsSync(old) && readdirSync(old).length > 0;
  const message = `Spostare la musica già scaricata in ${prettyPath(next)}?`;
  if (hasFiles && (await confirm({ message, default: true }, tidy))) {
    if (next.startsWith(old + "/")) {
      notify.fail("La nuova cartella non può stare dentro quella vecchia.");
      return;
    }
    mkdirSync(next, { recursive: true });
    const skipped = await ui.withSpinner("Sposto i file...", async () => mergeMove(old, next));
    if (skipped.length) {
      notify.warn(
        `${skipped.length} file non spostati: esiste già un file diverso con lo stesso nome ` +
          `(rimasti in ${prettyPath(old)})`,
      );
    } else notify.ok("Musica spostata.");
  }
  cfg.folder = next;
  save(cfg);
  notify.ok(`Cartella impostata: ${prettyPath(next)}`);
}

function hoursLabel(h: number): string {
  if (h === 0) return "mai";
  if (h === 1) return "ogni ora";
  if (h === 24) return "ogni giorno (alle 12:00)";
  return `ogni ${h} ore`;
}

function applyAuto(cfg: Config): void {
  save(cfg);
  const error = auto.apply(cfg);
  if (error) notify.fail(`Impossibile configurare la sync automatica: ${error}`);
}

async function changeAuto(cfg: Config): Promise<void> {
  for (;;) {
    screen(cfg, "Sync automatica");
    const choice = await select<string>(
      {
        theme,
        message: "Sync automatica (in background, con notifica a fine sync)",
        choices: [
          {
            name: `All'accesso al PC: ${cfg.autostart ? chalk.green("sì") : "no"}`,
            value: "autostart",
            description: `Sincronizza ${auto.STARTUP_DELAY.replace("min", " minuti")} dopo il login`,
          },
          {
            name: `Periodica: ${cfg.autosync ? chalk.green(hoursLabel(cfg.autosync)) : "mai"}`,
            value: "autosync",
            description: "Se il PC era spento all'ora prevista, recupera appena lo accendi",
          },
          { name: "← Indietro", value: "back" },
        ],
      },
      tidy,
    );
    if (choice === "back") return;
    if (choice === "autostart") {
      cfg.autostart = !cfg.autostart;
      applyAuto(cfg);
    } else {
      cfg.autosync = await select<number>(
        {
          theme,
          message: "Ogni quanto?",
          default: cfg.autosync,
          choices: AUTOSYNC_HOURS.map((h) => ({ name: hoursLabel(h), value: h })),
        },
        tidy,
      );
      applyAuto(cfg);
    }
    if (cfg.prune === "chiedi" && auto.isEnabled(cfg)) {
      notify.warn(
        'Con "chiedi" la sync automatica non rimuove le tracce tolte da SoundCloud: ' +
          "te lo segnala nella notifica e confermi dal menu.",
      );
    }
  }
}

async function changeJobs(cfg: Config): Promise<void> {
  screen(cfg, "Download paralleli");
  const n = await number(
    {
      message: "Quanti download in parallelo? (1-12, meno = meno blocchi da SoundCloud)",
      default: cfg.jobs,
      min: 1,
      max: 12,
    },
    tidy,
  );
  if (n) {
    cfg.jobs = n;
    save(cfg);
  }
}

async function changePrune(cfg: Config): Promise<void> {
  screen(cfg, "Tracce tolte da SoundCloud");
  cfg.prune = await select<PruneMode>(
    {
      theme,
      message: "Cosa fare con le tracce tolte dalle playlist su SoundCloud?",
      default: cfg.prune,
      choices: Object.entries(PRUNE_MODES).map(([value, name]) => ({ name, value: value as PruneMode })),
    },
    tidy,
  );
  save(cfg);
}

async function syncNow(cfg: Config): Promise<void> {
  screen(cfg, "Sincronizzazione");
  await runSync(cfg, { interactive: true, confirm: (message) => confirm({ message, default: false }) });
  ui.print();
  await input({ message: ui.dim("Invio per tornare al menu"), theme: { prefix: "" } }, tidy);
}

const DAY = 86_400_000;

export function failedTable(entries: [string, unavailable.Entry][]): string {
  const w = ui.width() - 10;
  const widths = [Math.floor(w * 0.2), Math.floor(w * 0.35)];
  const t = ui.table(["Playlist", "Traccia", "Motivo"], {
    title: chalk.red(`Non scaricate (${entries.length})`),
    color: chalk.red,
    colWidths: [...widths, w - widths[0] - widths[1]],
  });
  for (const [id, e] of entries) {
    const until = new Date(Date.parse(e.since) + unavailable.RETRY_DAYS * DAY).toLocaleDateString("it-IT");
    const when = e.temporary ? "errore temporaneo: si riprova a ogni sync" : `saltata fino al ${until}`;
    const tried = e.tried?.length ? ` · cercata su ${e.tried.join(", ")}` : "";
    t.push([e.playlists?.join(", ") ?? "?", e.title ?? `traccia ${id}`, `${e.reason}\n${ui.dim(when + tried)}`]);
  }
  return t.toString();
}

/** Tracce non scaricate: le mostra e permette di riprovarle subito, su tutte le fonti. */
async function showFailed(cfg: Config): Promise<void> {
  screen(cfg, "Tracce non scaricate");
  const registry = unavailable.load();
  if (await ui.withSpinner("Leggo i titoli da SoundCloud...", () => fillTitles(registry))) unavailable.save(registry);
  const entries = [...registry].sort(([, a], [, b]) =>
    `${a.playlists?.[0]} ${a.title}`.localeCompare(`${b.playlists?.[0]} ${b.title}`),
  );
  if (!entries.length) {
    notify.ok("Nessuna traccia non scaricata.");
    return;
  }
  ui.print(failedTable(entries));
  ui.print();
  const choice = await select(
    {
      theme,
      message: "Riprovare a scaricarle?",
      choices: [
        { name: "Riprova tutte", value: "all", description: "Da SoundCloud e poi da tutte le altre fonti, anche già provate" },
        { name: "Scegli quali riprovare", value: "pick" },
        { name: "← Indietro", value: "back" },
      ],
    },
    tidy,
  );
  if (choice === "back") return;
  const ids =
    choice === "all"
      ? entries.map(([id]) => id)
      : await checkbox(
          {
            message: "Quali? (spazio per scegliere, Invio per confermare)",
            choices: entries.map(([id, e]) => ({
              name: `${e.title ?? `traccia ${id}`} ${ui.dim(`· ${e.playlists?.join(", ") ?? "?"}`)}`,
              value: id,
            })),
          },
          tidy,
        );
  if (!ids.length) return;
  unavailable.forget(ids);
  // La sync rilegge le playlist: le tracce tolte dal registro risultano mancanti e si riscaricano.
  await syncNow(cfg);
}

export async function menu(cfg: Config): Promise<number> {
  // Riallinea i timer systemd alla configurazione (se cambiata a mano o da un'altra versione).
  const error = auto.apply(cfg);
  if (error) notify.fail(`Sync automatica non configurabile: ${error}`);
  try {
    for (;;) {
      screen(cfg);
      const choice = await select(
        {
          theme,
          message: "Cosa vuoi fare?",
          choices: [
            { name: "Sincronizza ora", value: "sync" },
            { name: "Profili e playlist", value: "sources" },
            { name: "Cambia cartella", value: "folder" },
            { name: `Download paralleli ${ui.dim(`(${cfg.jobs})`)}`, value: "jobs" },
            { name: `Tracce tolte da SoundCloud ${ui.dim(`(${cfg.prune})`)}`, value: "prune" },
            { name: `Sync automatica ${ui.dim(`(${auto.describe(cfg)})`)}`, value: "auto" },
            {
              name: `Tracce non scaricate ${ui.dim(`(${unavailable.load().size})`)}`,
              value: "failed",
              description: "Vedi perché non sono state scaricate e riprova",
            },
            {
              name: `Cerca altrove i brani non scaricabili ${ui.dim(`(${cfg.fallback ? "sì" : "no"})`)}`,
              value: "fallback",
              description:
                "DRM, Go+, blocchi: cerca su SoundCloud, YouTube Music, YouTube e Bandcamp e scarica solo se la corrispondenza è sicura",
            },
            { name: "Esci", value: "quit" },
          ],
        },
        tidy,
      );
      if (choice === "sync") await syncNow(cfg);
      else if (choice === "failed") await showFailed(cfg);
      else if (choice === "sources") await manageSources(cfg);
      else if (choice === "folder") await changeFolder(cfg);
      else if (choice === "jobs") await changeJobs(cfg);
      else if (choice === "prune") await changePrune(cfg);
      else if (choice === "auto") await changeAuto(cfg);
      else if (choice === "fallback") {
        cfg.fallback = !cfg.fallback;
        save(cfg);
        notify.ok(`Ricerca altrove ${cfg.fallback ? "attivata" : "disattivata"}.`);
      }
      else return 0;
    }
  } finally {
    ui.clearScreen();
  }
}
