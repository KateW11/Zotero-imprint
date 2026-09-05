import { getPref } from "../utils/prefs";
import { cleanField } from "../utils/naming";
import { normText, ratio } from "../utils/similarity";
import { doiVariants, normaliseDoi } from "./pdfText";
import { readJSON, writeJSON } from "../utils/store";

/**
 * Crossref, with an on-disk cache and polite rate limiting.
 *
 * The cache matters on re-runs: a second pass over the same folder should cost
 * nothing and must not hammer a free public API.
 */

const ITEM_URL = "https://api.crossref.org/works/";
const SEARCH_URL = "https://api.crossref.org/works";
const CACHE_FILE = "crossref-cache.json";
const DELAY_MS = 250;

/**
 * Crossref work type to Zotero item type. Anything unmapped is held for review
 * rather than guessed: a wrong item type is a wrong citation.
 */
const TYPE_MAP: Record<string, string> = {
  "journal-article": "journalArticle",
  "posted-content": "preprint",
  "proceedings-article": "conferencePaper",
  "book-chapter": "bookSection",
  report: "report",
  book: "book",
};

const ARTICLE_TYPES = [
  "journal-article",
  "posted-content",
  "proceedings-article",
];

export interface CrossrefRecord {
  itemType: string;
  title: string;
  DOI: string;
  date: string;
  publicationTitle: string;
  volume: string;
  issue: string;
  pages: string;
  creators: Array<{
    creatorType: string;
    firstName: string;
    lastName: string;
  }>;
  year: string;
  surnames: string[];
  crossrefType: string;
}

type Cache = Record<string, unknown>;

let cache: Cache | null = null;
let dirty = false;
let lastCall = 0;

async function loadCache(): Promise<Cache> {
  if (!cache) cache = await readJSON<Cache>(CACHE_FILE, {});
  return cache;
}

/** Call after a batch: one write rather than one per lookup. */
export async function flushCache(): Promise<void> {
  if (cache && dirty) {
    await writeJSON(CACHE_FILE, cache);
    dirty = false;
  }
}

async function cached<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const store = await loadCache();
  if (Object.prototype.hasOwnProperty.call(store, key)) {
    return store[key] as T;
  }
  const wait = DELAY_MS - (Date.now() - lastCall);
  if (wait > 0) await Zotero.Promise.delay(wait);
  const value = await fetch();
  lastCall = Date.now();
  store[key] = value;
  dirty = true;
  return value;
}

function withMailto(url: string): string {
  const mailto = (getPref("crossrefEmail") || "").trim();
  if (!mailto) return url;
  return url + (url.includes("?") ? "&" : "?") + "mailto=" + encodeURIComponent(mailto);
}

async function getJSON(url: string): Promise<any> {
  const res = await Zotero.HTTP.request("GET", withMailto(url), {
    responseType: "json",
    headers: { Accept: "application/json" },
    timeout: 30000,
    errorDelayMax: 0,
  });
  return res.response;
}

/**
 * The Crossref record for a DOI, or null.
 *
 * Tries the progressively shorter forms of the DOI, because a DOI printed
 * across a line break comes out of text extraction damaged and the trailing
 * part is the part that goes wrong.
 */
export async function byDoi(doi: string): Promise<CrossrefRecord | null> {
  for (const variant of doiVariants(doi)) {
    const key = "doi:" + variant.toLowerCase();
    const message = await cached(key, async () => {
      try {
        return (await getJSON(ITEM_URL + encodeURIComponent(variant)))?.message ?? null;
      } catch {
        // A DOI that does not resolve is an answer, not a failure: cache it so
        // a re-run does not ask again.
        return null;
      }
    });
    const record = recordFrom(message);
    if (record) return record;
  }
  return null;
}

/** Crossref candidates for a bibliographic string. */
export async function search(query: string, rows = 5): Promise<any[]> {
  const key = "q:" + query.toLowerCase();
  return cached(key, async () => {
    try {
      const url =
        SEARCH_URL +
        "?query.bibliographic=" +
        encodeURIComponent(query) +
        "&rows=" +
        rows;
      return (await getJSON(url))?.message?.items ?? [];
    } catch {
      return [];
    }
  });
}

/**
 * Strict acceptance test for a Crossref candidate.
 *
 * Relevance score alone is not evidence. Crossref indexes books poorly, so a
 * book title routinely matches a later work ABOUT the book with a high score.
 * Require a title-similarity floor, year agreement with the filename, and a
 * publication type that is actually an article.
 */
export function accept(
  item: any,
  filename: string,
  titleFloor = 0.55,
  yearTolerance = 1,
): { ok: boolean; reason: string } {
  const stem = String(filename).replace(/^.*[/\\]/, "").replace(/\.pdf$/i, "");
  const candidateTitle = (item?.title || []).join(" ");
  const sim = ratio(normText(stem), normText(candidateTitle));

  if (!ARTICLE_TYPES.includes(item?.type)) {
    return { ok: false, reason: `type=${item?.type}` };
  }
  if (sim < titleFloor) {
    return { ok: false, reason: `title ${sim.toFixed(2)} < ${titleFloor}` };
  }
  const fileYear = /\b(?:19|20)\d{2}\b/.exec(stem);
  const candidateYear = item?.issued?.["date-parts"]?.[0]?.[0];
  if (
    fileYear &&
    candidateYear &&
    Math.abs(Number(fileYear[0]) - Number(candidateYear)) > yearTolerance
  ) {
    return { ok: false, reason: `year ${fileYear[0]} vs ${candidateYear}` };
  }
  return { ok: true, reason: `title ${sim.toFixed(2)}` };
}

/** Crossref message to the fields an item needs. */
export function recordFrom(message: any): CrossrefRecord | null {
  if (!message) return null;
  const crossrefType = message.type;
  const itemType = TYPE_MAP[crossrefType];
  if (!itemType) return null;

  const title = cleanField((message.title || []).join(" "));
  if (!title) return null;

  const parts = message.issued?.["date-parts"]?.[0] || [];
  const date = parts[0]
    ? parts
        .filter((x: number) => x != null)
        .map((x: number, i: number) => (i ? String(x).padStart(2, "0") : String(x)))
        .join("-")
    : "";

  const creators = (message.author || [])
    .map((a: any) => ({
      creatorType: "author",
      firstName: cleanField(a.given || ""),
      lastName: cleanField(a.family || a.name || ""),
    }))
    .filter((c: any) => c.lastName);

  const container = (message["container-title"] || []).join(" ");

  return {
    itemType,
    title,
    DOI: normaliseDoi(message.DOI || ""),
    date,
    publicationTitle: cleanField(container),
    volume: String(message.volume || ""),
    issue: String(message.issue || ""),
    pages: String(message.page || ""),
    creators,
    year: date ? date.slice(0, 4) : "",
    surnames: creators.map((c: any) => c.lastName),
    crossrefType,
  };
}
