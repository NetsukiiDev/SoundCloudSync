import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanArtist, cleanTitle, desiredTags, splitTitle, type TrackMeta } from "../src/tags.ts";

const meta = (title: string, more: Partial<TrackMeta> = {}): TrackMeta => ({
  id: "1", title, uploader: "Etichetta", artist: null, track: null, album: null, genre: null,
  date: "20240315", url: "https://soundcloud.com/x/y", ...more,
});

test("cleanTitle toglie la promozione, tiene remix ed edit", () => {
  assert.equal(cleanTitle("Black Sky (Zentryc) [FREE DOWNLOAD]"), "Black Sky (Zentryc)");
  assert.equal(cleanTitle("Psychotherapy (Free Download)"), "Psychotherapy");
  assert.equal(cleanTitle("[PREMIERE] Never Gonna Stop"), "Never Gonna Stop");
  assert.equal(cleanTitle("Alta [ Free Download ]"), "Alta");
  assert.equal(cleanTitle("Gangsta's Paradise (Holy Priest Hard Techno Edit)"), "Gangsta's Paradise (Holy Priest Hard Techno Edit)");
  assert.equal(cleanTitle("Dies Irae | FREE DL"), "Dies Irae");
  assert.equal(cleanTitle("[FREE DOWNLOAD]"), "[FREE DOWNLOAD]"); // non lascia un titolo vuoto
  assert.equal(cleanTitle("Dope Shit [TAKEN FROM \"GALAXY OF CORE\" COMPILATION]"), "Dope Shit");
  assert.equal(cleanTitle("Absolute Destruction [INNERGATED]", "INNERGATED"), "Absolute Destruction");
  assert.equal(cleanTitle("Tempolimit - 180BPM I FREE DL"), "Tempolimit - 180BPM");
});

test("splitTitle: l'artista vero sta nel titolo", () => {
  assert.deepEqual(splitTitle(meta("Azulo - Black Sky (Zentryc) [FREE DOWNLOAD]", { uploader: "Azulo" })), {
    artist: "Azulo",
    title: "Black Sky (Zentryc)",
  });
  assert.deepEqual(splitTitle(meta("Coolio - Gangsta's Paradise (Holy Priest Hard Techno Edit)", { artist: "HOLY PRIEST" })), {
    artist: "Coolio",
    title: "Gangsta's Paradise (Holy Priest Hard Techno Edit)",
  });
  assert.deepEqual(splitTitle(meta("Bloodlust & Holy Priest - Hit The Floor")), {
    artist: "Bloodlust & Holy Priest",
    title: "Hit The Floor",
  });
});

test("splitTitle: senza trattino usa l'artista di SoundCloud, poi chi ha caricato", () => {
  assert.deepEqual(splitTitle(meta("HARDSTYLE IS BACK", { artist: "Krowdexx， TOZA" })), {
    artist: "Krowdexx, TOZA",
    title: "HARDSTYLE IS BACK",
  });
  assert.deepEqual(splitTitle(meta("Locked Down", { uploader: "Painbringer" })), { artist: "Painbringer", title: "Locked Down" });
});

test("cleanArtist", () => {
  assert.equal(cleanArtist("HOLY PRIEST， Nico Moreno， Warface"), "HOLY PRIEST, Nico Moreno, Warface");
});

test("album: quello vero se c'è, altrimenti la playlist come compilation", () => {
  const p = { playlist: "Hard Techno", index: 7 };
  const t = desiredTags(meta("Doruksen - Intoxicated", { genre: "Techno" }), p);
  assert.deepEqual(
    { album: t.album, album_artist: t.album_artist, track: t.track, date: t.date, compilation: t.compilation, genre: t.genre },
    { album: "Hard Techno", album_artist: "Various Artists", track: "7", date: "2024", compilation: "1", genre: "Techno" },
  );
  const real = desiredTags(meta("Doruksen - Intoxicated", { album: "Intoxicated EP" }), p);
  assert.equal(real.album, "Intoxicated EP");
  assert.equal(real.album_artist, "Doruksen");
  assert.equal(real.compilation, "");
});

test("commento: link originale, e la fonte se viene da YouTube", () => {
  assert.equal(desiredTags(meta("A - B"), { playlist: "P", index: 1 }).comment, "https://soundcloud.com/x/y");
  assert.match(desiredTags(meta("A - B", { source: "https://youtu.be/z" }), { playlist: "P", index: 1 }).comment, /^Scaricata da YouTube: https:\/\/youtu\.be\/z/);
});
