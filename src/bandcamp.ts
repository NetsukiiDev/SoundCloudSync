// Ricerca di brani su Bandcamp, con l'API pubblica che usa la casella di ricerca del sito
// (yt-dlp scarica da Bandcamp, ma non sa cercarci). I risultati non hanno la durata: vedi
// ytdlp.details.

import type { SearchResult } from "./ytdlp.ts";

const API = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic";

interface Hit {
  type?: string;
  id?: number;
  name?: string;
  band_name?: string;
  item_url_path?: string;
}

export async function searchBandcamp(query: string): Promise<SearchResult[]> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ search_text: query, search_filter: "t", full_page: false, fan_id: null }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ERROR: Bandcamp ha risposto ${res.status}`);
  const hits: Hit[] = (await res.json())?.auto?.results ?? [];
  return hits
    .filter((h) => h.type === "t" && h.item_url_path)
    .map((h) => ({
      id: String(h.id),
      title: h.name ?? "",
      channel: h.band_name ?? null,
      duration: null,
      url: h.item_url_path!,
    }));
}
