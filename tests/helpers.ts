import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setPrint } from "../src/ui.ts";

/** Home finta: nessun test tocca config, log o cestino veri. */
export function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "scsync-"));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir; // su Windows homedir() legge questo, non HOME
  process.env.XDG_DATA_HOME = join(dir, "share");
  setPrint(() => {});
  return dir;
}

export function touch(path: string, content = "x"): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}
