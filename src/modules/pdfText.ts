/**
 * Reading the DOI out of a PDF that is not in the library yet.
 *
 * This is what makes renaming accurate. Resolving from the filename is
 * guesswork -- a publisher default like fpsyg-09-00282.pdf carries no title at
 * all -- while the DOI printed on page one identifies the paper exactly.
 *
 * Zotero's documented Zotero.PDFWorker.getFullText() takes an attachment item,
 * looks up its path and reads the file itself, so it cannot be pointed at a
 * loose file. The worker underneath it takes a buffer, so we read the file and
 * call the worker directly: same PDF engine as the rest of Zotero, no
 * temporary items, no second PDF library bundled in.
 *
 * Those worker methods are internal, so they are checked for at call time and
 * there is a slower fallback that goes through a temporary linked attachment.
 */

export const DOI_RE = /\b10\.\d{4,9}\/[-._;()[\]<>/:A-Za-z0-9]+/gi;

/** Trim the trailing punctuation that PDF text extraction drags in. */
export function cleanDoi(raw: string): string {
  let d = String(raw ?? "")
    .trim()
    .replace(/[).,;:'"\]>]+$/, "");
  // A DOI printed across a line break arrives with the break already stripped
  // by the extractor; a trailing "pdf" or "Downloaded" is line noise.
  d = d.replace(/(pdf|downloadedfrom|http.*)$/i, "");
  return d.replace(/[).,;:'"\]>-]+$/, "");
}

/**
 * The extracted DOI, then progressively shorter forms of it.
 *
 * Two real shapes defeat a single-shot lookup. Older ESA and AGU DOIs contain
 * brackets --
 *
 *     10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2
 *
 * -- so a pattern that stops at "[" truncates them, while one that allows
 * brackets can swallow a bracketed citation that follows on the page. Try the
 * full match first, then the cut-at-bracket form, then the bare prefix.
 */
export function doiVariants(doi: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const candidates = [
    doi,
    doi.split("[")[0].replace(/[(.,;:-]+$/, ""),
    doi.replace(/[^0-9A-Za-z]+$/, ""),
  ];
  for (const cand of candidates) {
    const c = (cand || "").trim();
    if (c.length > 7 && !seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      out.push(c);
    }
  }
  return out;
}

/** Bare DOI from whatever shape it is stored in. */
export function normaliseDoi(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/, "")
    .trim();
}

function pdfWorker(): any {
  return (Zotero as any).PDFWorker;
}

/** True when the worker's internals are where we expect them. */
function canQueryWorkerDirectly(): boolean {
  const w = pdfWorker();
  return (
    !!w && typeof w._enqueue === "function" && typeof w._query === "function"
  );
}

/** A fresh ArrayBuffer each time: the worker call transfers and detaches it. */
function freshBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

async function queryWorker(
  bytes: Uint8Array,
  action: "getFulltext" | "getRecognizerData",
  data: Record<string, unknown>,
): Promise<any> {
  const w = pdfWorker();
  const buf = freshBuffer(bytes);
  return w._enqueue(
    () => w._query(action, { buf, ...data }, [buf]),
    false,
  );
}

export interface PdfFacts {
  /** DOI as printed, or null. */
  doi: string | null;
  totalPages: number;
  /** Where the DOI came from, for reporting. */
  source: "metadata" | "text" | null;
}

/**
 * DOI from inside the PDF: the document metadata first, then the text of the
 * first pages.
 *
 * The Python tool read XMP metadata first. Zotero's worker does not expose
 * XMP, but it does expose the PDF's info dictionary, which is where most
 * publishers stamp the DOI, so most of that advantage survives.
 */
export async function readPdfFacts(
  path: string,
  pages = 2,
): Promise<PdfFacts> {
  if (!canQueryWorkerDirectly()) {
    return readViaTemporaryAttachment(path, pages);
  }

  const bytes = await IOUtils.read(path);
  let totalPages = 0;

  try {
    const rec = await queryWorker(bytes, "getRecognizerData", {
      password: undefined,
    });
    totalPages = rec?.totalPages || 0;
    const fromMeta = firstDoiIn(Object.values(rec?.metadata || {}).join("\n"));
    if (fromMeta) return { doi: fromMeta, totalPages, source: "metadata" };
  } catch (e) {
    Zotero.debug(`Imprint: recognizer data failed for ${path}: ${e}`);
  }

  try {
    const full = await queryWorker(bytes, "getFulltext", {
      maxPages: pages,
      password: undefined,
    });
    totalPages = full?.totalPages || totalPages;
    const fromText = firstDoiIn(full?.text || "");
    if (fromText) return { doi: fromText, totalPages, source: "text" };
  } catch (e) {
    Zotero.debug(`Imprint: fulltext failed for ${path}: ${e}`);
  }

  return { doi: null, totalPages, source: null };
}

/**
 * Wiley and others stamp the JOURNAL's DOI in a PDF's metadata, alongside or
 * instead of the article's: 10.1111/(ISSN)2044-8295 is British Journal of
 * Psychology, not the paper. Accepting one renames and imports the wrong work
 * entirely, and it looks like a clean confident match while doing it.
 *
 * pypdfium2 never surfaced these, so the Python tool never had to guard
 * against them. Zotero's PDF engine does surface them.
 */
function isJournalLevelDoi(doi: string): boolean {
  return /\(issn\)/i.test(doi);
}

function firstDoiIn(text: string): string | null {
  for (const hit of String(text || "").match(DOI_RE) || []) {
    const d = cleanDoi(hit);
    if (d.length > 7 && !isJournalLevelDoi(d)) return d;
  }
  return null;
}

/**
 * Fallback for a Zotero release that has moved the worker internals: link the
 * file as a temporary standalone attachment, use the documented API, then
 * erase it outright. Linked rather than imported, so the file is never copied.
 */
async function readViaTemporaryAttachment(
  path: string,
  pages: number,
): Promise<PdfFacts> {
  let attachment: Zotero.Item | null = null;
  try {
    // linkFromFile takes no libraryID; a standalone linked attachment goes
    // to the user library, which is the only place this would be wanted.
    attachment = await Zotero.Attachments.linkFromFile({ file: path });
    const full = await Zotero.PDFWorker.getFullText(attachment!.id, pages);
    const doi = firstDoiIn(full?.text || "");
    return {
      doi,
      totalPages: full?.totalPages || 0,
      source: doi ? "text" : null,
    };
  } catch (e) {
    Zotero.debug(`Imprint: temporary-attachment fallback failed: ${e}`);
    return { doi: null, totalPages: 0, source: null };
  } finally {
    if (attachment) {
      try {
        await attachment.eraseTx();
      } catch (e) {
        Zotero.debug(`Imprint: could not remove temporary attachment: ${e}`);
      }
    }
  }
}
