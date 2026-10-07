// Pezzi dell'interfaccia: barre, riquadri, vista che si aggiorna sul posto, tabelle.

import chalk from "chalk";
import Table from "cli-table3";
import { createLogUpdate } from "log-update";
import stringWidth from "string-width";

export const orange = chalk.hex("#ff8c00");

export const width = () => Math.max(40, Math.min(process.stdout.columns || 100, 140));

export let print: (s?: string) => void = (s = "") => {
  process.stdout.write(s + "\n");
};

/** Per i test: zittisce o cattura l'output. */
export function setPrint(fn: (s?: string) => void): void {
  print = fn;
}

/** Tronca a una larghezza visiva (emoji e caratteri larghi contano doppio). */
export function truncate(s: string, max: number): string {
  if (stringWidth(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (stringWidth(out + ch) > max - 1) break;
    out += ch;
  }
  return out + "…";
}

export const padEnd = (s: string, n: number) => s + " ".repeat(Math.max(0, n - stringWidth(s)));
export const padStart = (s: string, n: number) => " ".repeat(Math.max(0, n - stringWidth(s))) + s;

export function bar(percent: number, size: number): string {
  const p = Math.max(0, Math.min(100, percent));
  const full = Math.floor((p / 100) * size);
  const done = chalk.magenta("━".repeat(full));
  if (full >= size) return chalk.green("━".repeat(size));
  return done + chalk.gray((full ? "╺" : "━") + "━".repeat(size - full - 1));
}

/** Cancella il terminale e riparte dall'angolo in alto (ogni schermata del menu). */
export function clearScreen(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b[H\x1b[2J\x1b[3J");
}

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
export const spinner = () => chalk.green(FRAMES[Math.floor(Date.now() / 80) % FRAMES.length]);

export function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

export function box(lines: string[], title: string, color = orange, w = width()): string {
  const inner = w - 4;
  const head = title ? ` ${title} ` : "";
  const side = Math.max(0, w - 2 - stringWidth(head));
  const left = Math.floor(side / 2);
  const top = color("╭" + "─".repeat(left)) + chalk.bold(head) + color("─".repeat(side - left) + "╮");
  const body = lines.map((l) => color("│") + " " + padEnd(truncate(l, inner), inner) + " " + color("│"));
  return [top, ...body, color("╰" + "─".repeat(w - 2) + "╯")].join("\n");
}

/** Riquadro stretto attorno al testo (intestazione del menu). */
export function card(lines: string[]): string {
  const w = Math.max(...lines.map((l) => stringWidth(l))) + 4;
  return box(lines, "", orange, w);
}

/** Regione del terminale ridisegnata sul posto, ~10 volte al secondo. */
export class Live {
  private timer: NodeJS.Timeout | null = null;
  private update = createLogUpdate(process.stdout, { showCursor: false });
  private render: () => string;
  constructor(render: () => string) {
    this.render = render;
  }

  start(): this {
    if (!process.stdout.isTTY) return this;
    this.timer = setInterval(() => this.update(this.render()), 100);
    return this;
  }

  /** Ferma e cancella la regione (resta solo ciò che si stampa dopo). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (process.stdout.isTTY) this.update.clear();
    this.update.done();
  }
}

/** Spinner su una riga mentre gira un'operazione. */
export async function withSpinner<T>(label: string | (() => string), work: () => Promise<T>) {
  const text = typeof label === "string" ? () => label : label;
  const live = new Live(() => `${spinner()} ${text()}`).start();
  try {
    return await work();
  } finally {
    live.stop();
  }
}

export function table(head: string[], opts: { title?: string; color?: (s: string) => string; colWidths?: number[]; align?: ("left" | "right")[] } = {}) {
  const color = opts.color ?? chalk.gray;
  const t = new Table({
    head: head.map((h) => chalk.bold(h)),
    ...(opts.align && { colAligns: opts.align }),
    ...(opts.colWidths && { colWidths: opts.colWidths, wordWrap: true }),
    style: { head: [], border: [] },
    chars: {
      top: color("─"), "top-mid": color("┬"), "top-left": color("╭"), "top-right": color("╮"),
      bottom: color("─"), "bottom-mid": color("┴"), "bottom-left": color("╰"), "bottom-right": color("╯"),
      left: color("│"), "left-mid": color("├"), mid: color("─"), "mid-mid": color("┼"),
      right: color("│"), "right-mid": color("┤"), middle: color("│"),
    },
  });
  return {
    push: (row: string[]) => t.push(row),
    get length() {
      return t.length;
    },
    toString: () => {
      const body = t.toString();
      if (!opts.title) return body;
      const w = stringWidth(body.split("\n")[0]);
      return padStart(chalk.bold(opts.title), Math.floor((w + stringWidth(opts.title)) / 2)) + "\n" + body;
    },
  };
}

export const ok = (s: string) => print(`${chalk.green("✓")} ${s}`);
export const fail = (s: string) => print(`${chalk.red("✗")} ${s}`);
export const warn = (s: string) => print(chalk.yellow(`⚠ ${s}`));
export const dim = chalk.dim;
