import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { beforeEach, test } from "node:test";
import { findRemoved, mergeMove, trackId, trash, trashDir } from "../src/library.ts";
import { sandbox, touch } from "./helpers.ts";

let dir: string;
beforeEach(() => {
  dir = sandbox();
});

test("trackId", () => {
  assert.equal(trackId("A - B [123].mp3"), "123");
  assert.equal(trackId("A [55].m4a.part-Frag16.part"), "55");
  assert.equal(trackId("A [55].m4a.ytdl"), "55");
  assert.equal(trackId("mia canzone.mp3"), null);
  assert.equal(trackId("Remix [2019] - X.mp3"), null);
});

test("findRemoved ignora i file aggiunti a mano", () => {
  const d = join(dir, "Acid");
  touch(join(d, "A - Tieni [1].mp3"));
  touch(join(d, "A - Via [2].mp3"));
  touch(join(d, "A - Via [2].jpg"));
  touch(join(d, "A - Rotta [3].m4a.part"));
  touch(join(d, "aggiunta a mano.mp3"));
  const removed = findRemoved(d, new Set(["1"]));
  assert.deepEqual([...removed.keys()].sort(), ["2", "3"]);
  assert.equal(removed.get("2")!.length, 2);
});

test("mergeMove unisce senza perdere file diversi", () => {
  const src = join(dir, "old");
  const dst = join(dir, "new");
  touch(join(src, "P", "same.mp3"), "a");
  touch(join(dst, "P", "same.mp3"), "a");
  touch(join(src, "P", "diff.mp3"), "a");
  touch(join(dst, "P", "diff.mp3"), "b");
  touch(join(src, "Q", "new.mp3"), "c");
  assert.deepEqual(mergeMove(src, dst), [join(src, "P", "diff.mp3")]);
  assert.equal(readFileSync(join(dst, "Q", "new.mp3"), "utf8"), "c");
  assert.ok(!existsSync(join(src, "P", "same.mp3")));
  assert.ok(!existsSync(join(src, "Q")));
});

test("cestino freedesktop, nomi uguali non si sovrascrivono", () => {
  const a = touch(join(dir, "m", "X [1].mp3"), "1");
  const b = touch(join(dir, "n", "X [1].mp3"), "2");
  const da = trash(a);
  const db = trash(b);
  assert.ok(!existsSync(a) && !existsSync(b));
  assert.equal(readFileSync(da, "utf8"), "1");
  assert.equal(readFileSync(db, "utf8"), "2");
  assert.notEqual(da, db);
  const info = readFileSync(join(trashDir(), "info", `${basename(db)}.trashinfo`), "utf8");
  assert.match(info, /^\[Trash Info\]\nPath=.*X%20%5B1%5D\.mp3\nDeletionDate=\d{4}-/);
});

test("le copie collegate in altre playlist restano", () => {
  const a = touch(join(dir, "A", "T [1].mp3"));
  mkdirSync(join(dir, "B"));
  const b = join(dir, "B", "T [1].mp3");
  linkSync(a, b);
  trash(a);
  assert.equal(readFileSync(b, "utf8"), "x");
});
