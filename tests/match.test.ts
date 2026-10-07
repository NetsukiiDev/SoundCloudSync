import assert from "node:assert/strict";
import { test } from "node:test";
import { type Candidate, normalize, pickBest, score, searchQuery, type SourceTrack } from "../src/match.ts";

// Dati veri: traccia DRM su SoundCloud e risultati di YouTube.
const src: SourceTrack = {
  title: "HARDSTYLE IS BACK",
  uploader: "Aggressive Records",
  artist: "Krowdexx， TOZA",
  track: "HARDSTYLE IS BACK",
  duration: 162.421,
};
const yt = (title: string, channel: string, duration: number): Candidate => ({ id: title, title, channel, duration, url: title });
const results = [
  yt("Krowdexx & TOZA - HARDSTYLE IS BACK (Official Videoclip)", "Aggressive Records", 162),
  yt("HARDSTYLE IS BACK", "Krowdexx", 163),
  yt("KROWDEXX - WE THE LOUDEST (LIVE) @ REBIRTH FESTIVAL 2026", "Aggressive Records", 1762),
  yt("Krowdexx x Toza - Hardstyle Is Back", "Union of Hardcore", 164),
];

test("sceglie il videoclip ufficiale", () => {
  const best = pickBest(src, results)!;
  assert.equal(best.candidate.title, results[0].title);
  assert.ok(best.score > 0.95);
});

test("query di ricerca pulita", () => {
  assert.equal(searchQuery(src), "krowdexx toza hardstyle is back");
  assert.equal(searchQuery({ title: "Acid Storm (Free Download) [PREMIERE]", uploader: "Kokko" }), "kokko acid storm");
});

test("lettere decorative e accenti", () => {
  assert.equal(normalize("𝖘𝖆𝖈𝖍𝖘𝖊𝖓𝖙𝖗𝖆𝖓𝖈𝖊 Sorcière"), "sachsentrance sorciere");
});

test("durata diversa: scartato", () => {
  assert.equal(score(src, yt("Krowdexx & TOZA - HARDSTYLE IS BACK", "x", 240)), 0);
});

test("remix, live, slowed... solo da una parte: scartato", () => {
  assert.equal(score(src, yt("Krowdexx & TOZA - HARDSTYLE IS BACK (Sefa Remix)", "x", 163)), 0);
  assert.equal(score(src, yt("Krowdexx & TOZA - Hardstyle Is Back (slowed + reverb)", "x", 163)), 0);
  const remix = { ...src, track: "HARDSTYLE IS BACK (Sefa Remix)" };
  assert.ok(score(remix, yt("Krowdexx & TOZA - HARDSTYLE IS BACK (Sefa Remix)", "x", 163)) > 0.9);
});

test("brano diverso dello stesso artista: scartato", () => {
  assert.equal(pickBest(src, [yt("Krowdexx & TOZA - WE THE LOUDEST", "Krowdexx", 162)]), null);
});

test("senza durata serve il titolo completo", () => {
  const noDur = { ...src, duration: null };
  assert.ok(score(noDur, yt("Krowdexx & TOZA - HARDSTYLE IS BACK", "x", 0)) >= 0.8);
  assert.equal(score(noDur, yt("HARDSTYLE IS BACK", "x", 0)), 0);
});

test("titolo SoundCloud già nella forma 'Artista - Titolo'", () => {
  const s = { title: "Kokko - Acid Storm (OUT ON ACID PIRATE.12)", uploader: "Kokko", duration: 300 };
  const full = score(s, yt("Kokko - Acid Storm (Out On Acid Pirate.12)", "Acid Pirate", 301));
  const short = score(s, yt("Kokko - Acid Storm", "Acid Pirate", 301));
  assert.ok(short >= 0.8, `senza il catalogo tra parentesi: ${short}`);
  assert.ok(full > short, "a parità di durata vince il titolo completo");
});
