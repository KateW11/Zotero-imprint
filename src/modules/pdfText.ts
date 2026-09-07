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
  // A trailing "pdf" or "Downloaded" is line noise. A dangling hyphen is
  // handled before this, in firstDoiIn: by the time a string arrives here it
  // has either been spliced back together or rejected, because stripping the
  // hyphen silently shortens the DOI to one that resolves to nothing.
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
/**
 * A DOI for a paper's supplementary material rather than the paper.
 *
 * APA and others mint a separate DOI for the supplement, and the supplement's
 * PDF carries it. Treating one as the article's DOI reports a correctly filed
 * appendix as the wrong paper.
 */
export function isSupplementDoi(doi: string): boolean {
  return /\.supp$/i.test(normaliseDoi(doi));
}

/**
 * The article DOI a supplement DOI belongs to, or "" if it is not one.
 * "10.1037/abc0000123.supp" is the appendix to "10.1037/abc0000123".
 */
export function supplementParentDoi(doi: string): string {
  const clean = normaliseDoi(doi);
  return isSupplementDoi(clean) ? clean.replace(/\.supp$/i, "") : "";
}

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

/**
 * Whether the direct worker route answers at all.
 *
 * Checking that the methods exist is not enough: on a Zotero version that has
 * changed the worker protocol they can still be there and simply never
 * resolve, which hangs every file instead of failing one. Probed once, then
 * remembered for the session.
 */
let directRouteWorks: boolean | null = null;

/* Read through a function: the flag can flip during an await, which narrowing
   cannot see. */
function directRouteFailed(): boolean {
  return directRouteWorks === false;
}
const PROBE_TIMEOUT_MS = 15000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | symbol> {
  const timedOut = Symbol("timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The loser of the race still settles. A worker call that rejects after the
  // timeout has already been reported is an expected outcome, not an
  // unhandled rejection in the user's debug log.
  work.catch(() => undefined);
  return Promise.race([
    work,
    new Promise<symbol>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), ms);
    }),
  ]).then(
    (result) => {
      // Without this the timer holds the event loop for the rest of its
      // duration on every file that answers promptly.
      clearTimeout(timer);
      return result === timedOut ? timedOut : (result as T);
    },
    (e) => {
      clearTimeout(timer);
      throw e;
    },
  );
}

/** True when the worker's internals are where we expect them. */
function canQueryWorkerDirectly(): boolean {
  const w = pdfWorker();
  return (
    !!w && typeof w._enqueue === "function" && typeof w._query === "function"
  );
}

/**
 * The action name Zotero's own method sends to the worker.
 *
 * Zotero 9 sends "getFulltext"; Zotero 10 namespaced them all to
 * "pdf.getFulltext". An unrecognised action is not rejected by the worker --
 * it is simply never answered -- so guessing costs a hang rather than an
 * error. Reading the name out of Zotero's own source is correct on any
 * version, including ones that do not exist yet.
 */
const actionNames = new Map<string, string>();

function actionFor(method: string, fallback: string): string {
  const cached = actionNames.get(method);
  if (cached) return cached;
  let name = fallback;
  try {
    const found = /_query\(\s*['"]([\w.]+)['"]/.exec(
      String(pdfWorker()?.[method]),
    );
    if (found) name = found[1];
  } catch {
    // keep the fallback
  }
  actionNames.set(method, name);
  return name;
}

/** A fresh ArrayBuffer each time: the worker call transfers and detaches it. */
function freshBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

async function queryWorker(
  bytes: Uint8Array,
  action: string,
  data: Record<string, unknown>,
): Promise<any> {
  const w = pdfWorker();
  const buf = freshBuffer(bytes);
  const call = w._enqueue(
    () => w._query(action, { buf, ...data }, [buf]),
    false,
  );

  // Only the first call is raced. Once the route is known to answer, a slow
  // file is just a slow file and must not be cut off.
  if (directRouteWorks === true) return call;

  const result = await withTimeout(call, PROBE_TIMEOUT_MS);
  if (typeof result === "symbol") {
    directRouteWorks = false;
    throw new Error(
      "Zotero's PDF worker did not answer; falling back to the slower route",
    );
  }
  directRouteWorks = true;
  return result;
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
export async function readPdfFacts(path: string, pages = 2): Promise<PdfFacts> {
  if (directRouteFailed() || !canQueryWorkerDirectly()) {
    return readViaTemporaryAttachment(path, pages);
  }

  const bytes = await IOUtils.read(path);
  let totalPages = 0;

  try {
    const rec = await queryWorker(
      bytes,
      actionFor("getRecognizerData", "getRecognizerData"),
      { password: undefined },
    );
    totalPages = rec?.totalPages || 0;
    const fromMeta = firstDoiIn(Object.values(rec?.metadata || {}).join("\n"));
    if (fromMeta) return { doi: fromMeta, totalPages, source: "metadata" };
  } catch (e) {
    Zotero.debug(`Imprint: recognizer data failed for ${path}: ${e}`);
    if (directRouteFailed()) return readViaTemporaryAttachment(path, pages);
  }

  try {
    const full = await queryWorker(
      bytes,
      actionFor("getFullText", "getFulltext"),
      {
        maxPages: pages,
        password: undefined,
      },
    );
    totalPages = full?.totalPages || totalPages;
    const fromText = firstDoiIn(full?.text || "");
    if (fromText) return { doi: fromText, totalPages, source: "text" };
  } catch (e) {
    Zotero.debug(`Imprint: fulltext failed for ${path}: ${e}`);
    // Same fallback as the metadata leg above. Without it, a route that dies
    // only on the fulltext call -- metadata having happened to answer -- ends
    // the read with no DOI and reports the file as unidentifiable, when the
    // slower route would have read it.
    if (directRouteFailed()) return readViaTemporaryAttachment(path, pages);
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
export function isJournalLevelDoi(doi: string): boolean {
  const suffix = normaliseDoi(doi).replace(/^10\.\d{4,9}\//, "");
  return (
    // Wiley: 10.1111/(ISSN)2044-8295 is the journal.
    /\(issn\)/i.test(doi) ||
    // A DOI that names a journal and nothing else -- 10.3389/fpsyg,
    // 10.1176/appi.ajp. An article's suffix carries an article number, a
    // year, a page or a sequence, so it always contains a digit.
    !/\d/.test(suffix) ||
    // Elsevier's issue-level placeholder, where the item position is the
    // literal X: 10.1016/S0022-3999(00)X0000-0.
    /^s\d{4}-\d{3}[\dx]\(\d{2}\)x\d{4}/i.test(suffix)
  );
}

/**
 * The rest of a DOI that was printed across a line break at a hyphen.
 *
 * Annual Reviews and others hyphenate the DOI to fit the column, so page one
 * carries `https://doi.org/10.1146/annurev-clinpsy-081219-` and the tail
 * `115627` starts the next line. The match stops at the break, and trimming
 * the dangling hyphen away produces a shorter string that still looks like a
 * well-formed DOI -- so the wrong DOI is accepted confidently and the only
 * evidence that it was cut is gone.
 *
 * A hyphen is never the last character of a real DOI, so a hyphen-terminated
 * match is always either a break to splice or a string to distrust.
 */
export function hyphenContinuation(text: string, from: number): string {
  // Immediately the next line, and only its leading DOI-shaped run: anything
  // further down the page is a different piece of text.
  const found = /^[ \t\r]*\n[ \t]*([A-Za-z0-9]{1,24})/.exec(
    String(text || "").slice(from),
  );
  return found ? found[1] : "";
}

/**
 * Whether the DOI at this offset sits inside a bracket that opened earlier on
 * the same line -- the shape a DOI has when the page cites it rather than
 * claims it.
 *
 * Page one carries the paper's own DOI as a bare link or a labelled line, and
 * carries other papers' DOIs inside the parenthetical citations of its
 * abstract. Both are well formed, and taking whichever the extractor happens
 * to emit first files the paper under the work it cites:
 *
 *     https://doi.org/10.1098/rstb.2024.0303          <- this paper
 *     ...(Cleeremans, Tallon-Baudry 2022, (doi:10.1093/nc/niac007))
 *
 * Only the text before the match is read, so a DOI carrying brackets of its
 * own -- 10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2 -- is unaffected. The
 * line is the unit because a citation and its brackets are laid out together,
 * while the paper's own DOI stands alone on its line.
 */
export function citedInBrackets(text: string, at: number): boolean {
  const src = String(text || "");
  const lineStart = src.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  let depth = 0;
  for (let i = lineStart; i < at; i += 1) {
    const c = src[i];
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

export function firstDoiIn(text: string): string | null {
  const src = String(text || "");
  const own: string[] = [];
  const cited: string[] = [];

  for (const m of src.matchAll(DOI_RE)) {
    let hit = m[0];
    const at = m.index ?? 0;
    if (hit.endsWith("-")) {
      const tail = hyphenContinuation(src, at + hit.length);
      // Cut with nothing to splice: distrust it rather than record a
      // confident DOI that belongs to no paper. The filename search is the
      // route that then has to identify the file.
      if (!tail) continue;
      hit += tail;
    }
    const d = cleanDoi(hit);
    if (d.length > 7 && !isJournalLevelDoi(d)) {
      if (citedInBrackets(src, at)) cited.push(d);
      else own.push(d);
    }
  }

  // A DOI the page presents as its own outranks one the page cites, whatever
  // order the extractor emitted them in -- that order is the thing that cannot
  // be relied on, and it is what put a cited DOI first on a real paper here.
  // Falling through to a cited one leaves every file whose only DOI is
  // bracketed reading exactly as it did.
  return own[0] ?? cited[0] ?? null;
}

/**
 * Marks the linked attachment the slow route creates for the length of one
 * read. Nothing the user would type: it exists so a leftover can be found.
 */
export const TEMP_ATTACHMENT_TAG = "imprint-temporary-read";

/**
 * Remove any temporary attachments a previous session left behind.
 *
 * The read below erases its attachment in a `finally`, which covers an error
 * but not a quit or a crash between linking and erasing. Called once at
 * startup; returns how many it removed so the number can be logged.
 *
 * Only linked-file attachments carrying the tag are touched, so a user who
 * happens to type the same tag on a real item is not affected.
 */
export async function sweepTemporaryAttachments(): Promise<number> {
  let removed = 0;
  try {
    const search = new (Zotero as any).Search();
    search.libraryID = Zotero.Libraries.userLibraryID;
    search.addCondition("tag", "is", TEMP_ATTACHMENT_TAG);
    const ids: number[] = await search.search();
    if (!ids?.length) return 0;
    for (const item of await Zotero.Items.getAsync(ids)) {
      if (
        !item.isAttachment() ||
        item.attachmentLinkMode !== Zotero.Attachments.LINK_MODE_LINKED_FILE
      ) {
        continue;
      }
      try {
        await item.eraseTx();
        removed += 1;
      } catch (e) {
        Zotero.debug(`Imprint: could not sweep temporary attachment: ${e}`);
      }
    }
  } catch (e) {
    Zotero.debug(`Imprint: temporary-attachment sweep failed: ${e}`);
  }
  return removed;
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
    // Tagged before it is read, so that a quit or a crash between here and
    // the erase below leaves something a sweep can recognise rather than an
    // unexplained attachment in My Library.
    try {
      attachment.addTag(TEMP_ATTACHMENT_TAG);
      await attachment.saveTx();
    } catch (e) {
      Zotero.debug(`Imprint: could not tag temporary attachment: ${e}`);
    }
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
