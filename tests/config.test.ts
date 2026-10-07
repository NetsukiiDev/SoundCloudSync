import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeEach, test } from "node:test";
import { ConfigError, configPath, defaults, load, save } from "../src/config.ts";
import { sandbox } from "./helpers.ts";

let home: string;
beforeEach(() => {
  home = sandbox();
});

test("i percorsi seguono HOME", () => {
  assert.ok(configPath().startsWith(home));
});

test("predefiniti senza file, senza condividere l'array", () => {
  const cfg = load();
  assert.equal(cfg.prune, "chiedi");
  cfg.sources.push("x");
  assert.notDeepEqual(defaults().sources, cfg.sources);
});

test("valori corretti e salvataggio", () => {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify({ jobs: 99, prune: "boh", folder: "~/X" }));
  const cfg = load();
  assert.equal(cfg.jobs, 12);
  assert.equal(cfg.prune, "chiedi");
  save(cfg);
  assert.deepEqual(load(), cfg);
});

test("JSON rotto", () => {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), "{");
  assert.throws(load, ConfigError);
});
