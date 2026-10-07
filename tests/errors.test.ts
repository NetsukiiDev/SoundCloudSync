import assert from "node:assert/strict";
import { test } from "node:test";
import { explain } from "../src/errors.ts";

test("404", () => {
  const { reason, raw } = explain(new Error("ERROR: [soundcloud] 123: Unable to download JSON metadata: HTTP Error 404"));
  assert.equal(reason, "Traccia rimossa o non trovata");
  assert.ok(raw.startsWith("Unable to download"));
});

test("Go+ con codici colore", () => {
  assert.equal(explain("\x1b[0;31mERROR:\x1b[0m [soundcloud] 4: This track is a preview (Go+)").reason, "Disponibile solo con SoundCloud Go+");
});

test("errore sconosciuto: resta il messaggio", () => {
  assert.deepEqual(explain("qualcosa di strano"), { reason: null, raw: "qualcosa di strano", permanent: false });
});

test("DRM è permanente, 403 no", () => {
  assert.equal(explain("ERROR: [soundcloud] 1: This video is DRM protected").permanent, true);
  assert.equal(explain("ERROR: [soundcloud] 1: HTTP Error 403: Forbidden").permanent, false);
});
