// Vista live di lavori in parallelo: un riquadro con una riga per lavoro in corso
// e una riga "Totale" con avanzamento, esiti, velocità, MB e tempo.

import chalk from "chalk";
import stringWidth from "string-width";
import * as ui from "./ui.ts";
import type { Status } from "./ytdlp.ts";

interface Row {
  label: string;
  status: Status;
}

export class TransferView<K> {
  private rows = new Map<K, Row>();
  private bytes = new Map<K, number>();
  private counts = { ok: 0, fail: 0 };
  private started = Date.now();
  private live: ui.Live;
  private title: string;
  private total: number;

  constructor(title: string, total: number) {
    this.title = title;
    this.total = total;
    this.live = new ui.Live(() => this.render());
  }

  start(): this {
    this.started = Date.now();
    this.live.start();
    return this;
  }

  add(key: K, label: string): void {
    this.rows.set(key, { label, status: { text: "avvio", percent: 0 } });
  }

  label(key: K, label: string): void {
    const row = this.rows.get(key);
    if (row) row.label = label;
  }

  update(key: K, s: Status): void {
    const row = this.rows.get(key);
    if (!row) return;
    row.status = { ...s, percent: s.percent ?? row.status.percent };
    if (s.bytes != null) this.bytes.set(key, s.bytes);
  }

  remove(key: K): void {
    this.rows.delete(key);
  }

  done(ok: boolean): void {
    if (ok) this.counts.ok++;
    else this.counts.fail++;
  }

  /** Ferma la vista e lascia a schermo la riga del totale con la velocità media. */
  stop(): void {
    this.live.stop();
    const secs = (Date.now() - this.started) / 1000;
    const avg = secs && this.totalBytes() ? `media ${(this.totalBytes() / 1e6 / secs).toFixed(1)} MB/s` : "";
    ui.print(this.totalLine(avg));
  }

  private totalBytes(): number {
    return [...this.bytes.values()].reduce((a, b) => a + b, 0);
  }

  private totalLine(speedText: string): string {
    const w = ui.width();
    const done = this.counts.ok + this.counts.fail;
    const mb = this.totalBytes() ? `  ${ui.dim(`${(this.totalBytes() / 1e6).toFixed(0)} MB`)}` : "";
    const right =
      ` ${done}/${this.total}  ${chalk.green(`✓ ${this.counts.ok}`)}  ${chalk.red(`✗ ${this.counts.fail}`)}` +
      (speedText ? `  ${chalk.cyan(speedText)}` : "") +
      mb +
      `  ${chalk.yellow(ui.duration(Date.now() - this.started))}`;
    const barSize = Math.max(10, w - stringWidth(right) - 8);
    return `${chalk.bold("Totale")} ${ui.bar((done / (this.total || 1)) * 100, barSize)}${right}`;
  }

  private render(): string {
    const w = ui.width();
    const labelW = Math.max(20, Math.floor((w - 4) * 0.5));
    const lines = [...this.rows.values()].map(({ label, status }) => {
      const name = ui.padEnd(ui.truncate(label, labelW), labelW);
      return `${ui.spinner()} ${name} ${ui.bar(status.percent ?? 0, 20)} ${ui.dim(status.text)}`;
    });
    const speed = [...this.rows.values()].reduce((a, r) => a + (r.status.speed ?? 0), 0);
    return [
      ui.box(lines.length ? lines : [ui.dim("…")], this.title),
      this.totalLine(speed ? `⇣ ${(speed / 1e6).toFixed(1)} MB/s` : ""),
    ].join("\n");
  }
}
