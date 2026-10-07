import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { writeTags } from "../src/tagger.ts";
import { desiredTags } from "../src/tags.ts";
import { sandbox } from "./helpers.ts";

const ffmpeg = (...args: string[]) => assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", ...args]).status, 0);

function probe(file: string) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], {
    encoding: "utf8",
  });
  const d = JSON.parse(r.stdout);
  const tags = Object.fromEntries(Object.entries(d.format.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { tags, cover: d.streams.some((s: { codec_type: string }) => s.codec_type === "video") };
}

test("scrive tag e copertina sul posto: le copie collegate restano collegate", async () => {
  const dir = sandbox();
  const a = join(dir, "Acid", "X - Y [1].mp3");
  const b = join(dir, "Tekno", "X - Y [1].mp3");
  mkdirSync(join(dir, "Acid"));
  mkdirSync(join(dir, "Tekno"));
  ffmpeg("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", "-metadata", "title=vecchio", a);
  linkSync(a, b);
  const jpg = join(dir, "cover.jpg");
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", jpg);

  const server = createServer((_, res) => res.end(readFileSync(jpg))).listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const tags = desiredTags(
      {
        id: "1", title: "Azulo - Black Sky [FREE DOWNLOAD]", uploader: "Azulo", artist: null, track: null,
        album: null, genre: "Techno", date: "20240101", url: "https://soundcloud.com/a/b",
      },
      { playlist: "Acid", index: 3 },
    );
    assert.ok(await writeTags(a, tags, `http://127.0.0.1:${port}/c.jpg`));
  } finally {
    server.close();
  }

  assert.equal(statSync(a).ino, statSync(b).ino);
  const { tags, cover } = probe(b);
  assert.ok(cover);
  assert.equal(tags.title, "Black Sky");
  assert.equal(tags.artist, "Azulo");
  assert.equal(tags.album, "Acid");
  assert.equal(tags.album_artist, "Various Artists");
  assert.equal(tags.track, "3");
  assert.equal(tags.genre, "Techno");
  assert.equal(tags.comment, "https://soundcloud.com/a/b");
});
