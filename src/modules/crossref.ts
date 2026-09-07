import { getPref } from "../utils/prefs";
import { cleanField, surnameOf } from "../utils/naming";
import { normText, ratio } from "../utils/similarity";
import { differentWork, filenameParts } from "../utils/matching";
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
  // Plain setTimeout rather than Zotero.Promise.delay: Zotero.Promise is
  // Bluebird, which Zotero has been removing.
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const value = await fetch();
  lastCall = Date.now();
  store[key] = value;
  dirty = true;
  return value;
}

function withMailto(url: string): string {
  const mailto = (getPref("crossrefEmail") || "").trim();
  if (!mailto) return url;
  return (
    url +
    (url.includes("?") ? "&" : "?") +
    "mailto=" +
    encodeURIComponent(mailto)
  );
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
        return (
          (await getJSON(ITEM_URL + encodeURIComponent(variant)))?.message ??
          null
        );
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
/**
 * Whether a candidate title opens by announcing itself as a notice about
 * another paper -- "Corrigendum: ...", "Reply to ..." -- when the filename
 * does not. `differentWork` compares from where two titles diverge, so it
 * does not see a marker that comes before anything they share.
 *
 * Deliberately not in this list: the "Supplemental Material for X" records
 * APA deposits. Four files in the 241-record corpus resolve to one, and
 * refusing them costs a correct identification; a supplement is separately
 * handled by DOI, not by title.
 */
const SELF_ANNOUNCED =
  /^(?:corrigendum|correction|corrected|erratum|errata|retraction|retracted|withdrawal|expression of concern|comment|commentary|reply|response|rejoinder|editorial|addendum|book review|review of|interview)\b/;

function announcesItself(candidate: string, fileTitle: string): boolean {
  return SELF_ANNOUNCED.test(candidate) && !SELF_ANNOUNCED.test(fileTitle);
}

/**
 * Whether the filename carries something of the candidate besides its title.
 *
 * Similarity is not evidence of identity. A review, an interview or a reply
 * quotes the title of the work it is about, so it scores as high against a
 * filename as the work itself would -- Crossref indexes books particularly
 * poorly this way. The year test below only fires when the filename happens
 * to carry a year to disagree with, so a filename with neither a year nor an
 * author in it has nothing at all behind the title.
 *
 * Real: "The Tao of Physics - Fritjof Capra.pdf" scored 0.69 against
 * Kauffman's 1977 review of the book in Isis, whose Crossref title is the
 * book's own title followed by its author's name. Nothing in the filename
 * disagreed, because there was nothing in the filename to disagree.
 */
function corroborates(stem: string, item: any, yearTolerance: number): boolean {
  const candidateYear = Number(item?.issued?.["date-parts"]?.[0]?.[0]);
  const fileYear = /\b(?:19|20)\d{2}\b/.exec(stem);
  if (
    fileYear &&
    candidateYear &&
    Math.abs(Number(fileYear[0]) - candidateYear) <= yearTolerance
  ) {
    return true;
  }
  const folded = normText(stem);
  for (const a of item?.author || []) {
    const surname = normText(surnameOf(String(a.family || a.name || "")));
    // Two characters is not a surname, it is a coincidence waiting to happen.
    if (surname.length > 2 && folded.includes(surname)) return true;
  }
  return false;
}

export function accept(
  item: any,
  filename: string,
  titleFloor = 0.55,
  yearTolerance = 1,
): { ok: boolean; reason: string } {
  const stem = String(filename)
    .replace(/^.*[/\\]/, "")
    .replace(/\.pdf$/i, "");
  const candidateTitle = (item?.title || []).join(" ");
  // Score the title against the title. Comparing the whole stem puts the
  // author surnames and the year into the ratio as noise, which costs a long
  // title enough similarity to fall under the floor -- and this is the route
  // that has to rescue a file whose printed DOI was damaged. On a publisher
  // default like fpsyg-09-00282.pdf there is no shape to parse and
  // filenameParts returns the stem, which is the old behaviour.
  const fileTitle = filenameParts(stem).title;
  const folded = normText(fileTitle);
  const other = normText(candidateTitle);
  let sim = ratio(folded, other);

  // A filename routinely carries the main title and drops the subtitle --
  // either because someone shortened it by hand or because a naming template
  // cut it -- and a subtitle is often longer than the title it follows, so an
  // exact match on the main clause can still score under the floor. Score
  // against the clause before the first colon as well, unless the words where
  // the two titles part company say this is a different work ("part two", a
  // corrigendum), which is the case a shared opening would otherwise wave
  // through.
  const mainClause = normText(candidateTitle.split(/[:?]/)[0]);
  if (
    sim < titleFloor &&
    mainClause &&
    mainClause !== other &&
    !differentWork(folded, other)
  ) {
    sim = Math.max(sim, ratio(folded, mainClause));
  }

  if (!ARTICLE_TYPES.includes(item?.type)) {
    return { ok: false, reason: `type=${item?.type}` };
  }
  // A corrigendum, a reply or a "part two" shares almost all of its title with
  // the paper it follows, so the ratio alone cannot separate them: they score
  // over the floor against each other. Crossref returns them as
  // journal-articles in their own right, and the search route has no DOI to
  // fall back on, so accepting one silently files the paper under the wrong
  // record. The reconcile path already refuses them; this one now does too.
  if (differentWork(folded, other) || announcesItself(other, folded)) {
    return { ok: false, reason: "different work" };
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
  // The title agreed. Nothing else did, and on this route there is no DOI to
  // settle it, so the match rests entirely on a string a work ABOUT this one
  // would carry too.
  if (!corroborates(stem, item, yearTolerance)) {
    return { ok: false, reason: "only the title agrees" };
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
        .map((x: number, i: number) =>
          i ? String(x).padStart(2, "0") : String(x),
        )
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
