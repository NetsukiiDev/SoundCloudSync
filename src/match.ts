// Decide se un risultato di ricerca è la stessa traccia di SoundCloud.
// Meglio non scaricare niente che scaricare il brano sbagliato.

export interface SourceTrack {
  title: string;
  uploader?: string | null;
  artist?: string | null;
  track?: string | null;
  duration?: number | null;
}

export interface Candidate {
  id: string;
  title: string;
  channel?: string | null;
  duration?: number | null;
  url: string;
}

export interface Scored<C extends Candidate = Candidate> {
  candidate: C;
  score: number; // 0..1
}

/** Soglia minima per scaricare. */
export const MIN_SCORE = 0.8;

// Parole che non dicono niente sull'identità del brano.
const NOISE = [
  "official music video", "official videoclip", "official video", "official audio",
  "official visualizer", "music video", "videoclip", "video clip", "lyric video", "lyrics",
  "visualizer", "free download", "free dl", "out now", "premiere", "official", "audio",
  "video", "hq", "hd", "4k", "original mix", "full version",
];

// Parole che indicano una versione diversa: se compaiono solo da una parte, non è lo stesso brano.
const VARIANTS = [
  "remix", "live", "cover", "nightcore", "sped up", "speed up", "slowed", "reverb", "8d",
  "bass boosted", "instrumental", "karaoke", "acapella", "vip", "mashup", "bootleg",
  "extended", "radio edit", "edit", "reverse", "hardstyle remix", "tutorial", "reaction",
];

const STOPWORDS = new Set(["x", "feat", "ft", "vs", "and", "e", "the", "a", "with"]);

/** Minuscolo, senza accenti né lettere "decorative" (𝖘𝖆𝖈𝖍𝖘𝖊𝖓 -> sachsen). */
export function normalize(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function stripNoise(s: string): string {
  let out = ` ${normalize(s).replace(/[^\p{L}\p{N}+]+/gu, " ")} `;
  for (const n of NOISE) out = out.replaceAll(` ${n} `, " ");
  return out.trim();
}

export function tokens(s: string): Set<string> {
  return new Set(stripNoise(s).split(/\s+/).filter((t) => t && !STOPWORDS.has(t)));
}

const variantsIn = (s: string) => {
  const text = ` ${stripNoise(s)} `;
  return new Set(VARIANTS.filter((v) => text.includes(` ${v} `)));
};

/** Il testo che identifica il brano: "Artista Titolo". */
export function identity(src: SourceTrack): string {
  if (src.artist) return `${src.artist} ${src.track || src.title}`;
  if (src.title.includes(" - ")) return src.title;
  return `${src.uploader ?? ""} ${src.title}`.trim();
}

/** Query di ricerca, senza decorazioni né parole inutili. */
export const searchQuery = (src: SourceTrack) => stripNoise(identity(src));

/** Senza le parti tra parentesi: "Acid Storm (OUT ON ACID PIRATE.12)" -> "Acid Storm". */
const core = (s: string) => s.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");

function recallOf(want: Set<string>, have: Set<string>): number {
  return want.size ? [...want].filter((t) => have.has(t)).length / want.size : 0;
}

export function score(src: SourceTrack, c: Candidate): number {
  const id = identity(src);
  if (!tokens(id).size) return 0;
  const have = tokens(`${c.title} ${c.channel ?? ""}`);
  // Le parentesi spesso contengono etichetta o catalogo: valgono un po' meno se mancano.
  const recall = Math.max(recallOf(tokens(id), have), recallOf(tokens(core(id)), have) * 0.95);

  // Versioni diverse (remix, live, slowed...) presenti solo da una parte.
  const a = variantsIn(identity(src));
  const b = variantsIn(c.title);
  const mismatched = [...new Set([...a, ...b])].filter((v) => a.has(v) !== b.has(v)).length;
  if (mismatched) return 0;

  // Durata: deve coincidere. Un videoclip può avere qualche secondo di intro.
  let dur = 0.5;
  if (src.duration && c.duration) {
    const diff = Math.abs(src.duration - c.duration);
    if (diff <= Math.max(5, src.duration * 0.04)) dur = 1;
    else if (diff <= Math.max(15, src.duration * 0.12)) dur = 0.6;
    else return 0;
  } else if (recall < 1) return 0; // senza durata serve un titolo identico

  // Piccolo bonus se il canale è dell'artista o dell'etichetta.
  const owners = tokens(`${src.artist ?? ""} ${src.uploader ?? ""}`);
  const channel = tokens(c.channel ?? "");
  const bonus = [...channel].some((t) => owners.has(t)) ? 0.05 : 0;

  return Math.min(1, recall * 0.7 + dur * 0.3 + bonus);
}

export function pickBest<C extends Candidate>(src: SourceTrack, candidates: C[]): Scored<C> | null {
  const scored = candidates
    .map((candidate) => ({ candidate, score: score(src, candidate) }))
    .filter((s) => s.score >= MIN_SCORE)
    .sort((x, y) => y.score - x.score);
  return scored[0] ?? null;
}
