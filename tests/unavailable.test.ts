import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cacheDir } from "../src/config.ts";
import { untried } from "../src/fallback.ts";
import { load } from "../src/unavailable.ts";
import { sandbox, touch } from "./helpers.ts";

test("registro vecchio: le ricerche fallite per errore si riprovano", () => {
  sandbox();
  const since = new Date().toISOString();
  touch(join(cacheDir(), "unavailable.json"));
  writeFileSync(
    join(cacheDir(), "unavailable.json"),
    JSON.stringify({
      "1": { reason: "Protetta da DRM: non scaricabile", since, searched: true },
      "2": { reason: "Protetta da DRM · ricerca su YouTube fallita: Accesso negato (403)", since, searched: true },
      "3": { reason: "Protetta da DRM", since, tried: ["SoundCloud", "YouTube"] },
    }),
  );
  const map = load();
  assert.deepEqual(map.get("1")!.tried, ["YouTube"]);
  assert.equal(map.get("2")!.tried, undefined);
  assert.deepEqual(untried(map.get("3")!.tried).map((s) => s.name), ["YouTube Music", "Bandcamp"]);
});
