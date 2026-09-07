import { getPref } from "../utils/prefs";
import { canonicalName, cleanField } from "../utils/naming";
import { itemsInCollection } from "./intake";
import { beginRun, stopRequested } from "../utils/cancel";
import { ListFormat, collect, extensionFor, render } from "./annotationList";

/**
 * Getting annotations back out of Zotero.
 *
 * Zotero keeps annotations in its database, not in the file, so every PDF in
 * the storage folder is the clean original -- a copy of that folder backs up
 * the papers and none of the reading. Two ways out of that:
 *
 *   pdf   a copy of the PDF with the annotations embedded as standard PDF
 *         annotations, which any reader opens and which Zotero can read back
 *         if the file is ever re-imported
 *   list  the highlights and comments as a readable document, one per paper,
 *         for quoting into a draft or reading away from the PDF
 *
 * Nothing in the library is modified. The export reads an attachment and its
 * annotations and writes separate files; the "transfer" argument, which would
 * move the annotations out of the library, is deliberately never passed.
 */

export type ExportStatus = "not written" | "out of date" | "current";

/** Which files to write for each annotated PDF. */
export type ExportWhat = "pdf" | "list" | "both";

export interface ExportOptions {
  what: ExportWhat;
  format: ListFormat;
  /** Limit to one collection and its subcollections. Null means the library. */
  collectionID?: number | null;
}

export interface ExportRecord {
  itemID: number;
  key: string;
  /** Target filename without an extension. */
  stem: string;
  /** Target PDF filename, shown in the table. */
  name: string;
  pdfPath: string;
  listPath: string;
  title: string;
  annotations: number;
  /** Newest annotation on this attachment, epoch ms. */
  newest: number;
  status: ExportStatus;
}

function expandPath(p: string): string {
  const t = (p || "").trim();
  if (!t.startsWith("~")) return t;
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  return t.replace(/^~/, home);
}

/** Trailing separators make two spellings of one folder compare unequal. */
function tidyDir(p: string): string {
  const full = expandPath(p);
  return full.length > 1 ? full.replace(/[/\\]+$/, "") : full;
}

/** Whether `dir` is `root` itself or sits inside it. */
function isWithin(dir: string, root: string): boolean {
  if (!dir || !root) return false;
  const a = dir.toLowerCase();
  const b = root.toLowerCase();
  return a === b || a.startsWith(b.endsWith("/") ? b : b + "/");
}

/**
 * Folders the export must never write into, because the files in them are the
 * only clean copies. Exported names are built by the same canonicalName() that
 * names filed PDFs, so a collision there is not bad luck -- it is the rule.
 *
 * "tree" refuses the folder and everything under it: Zotero keeps each stored
 * attachment in its own subfolder of storage, so any depth inside the data
 * folder sits among originals. "exact" refuses only the folder itself, because
 * staging and the drop folder hold their files at the top level -- a subfolder
 * of staging is beside them, which is where the default output goes.
 */
function protectedDirs(): Array<{
  path: string;
  what: string;
  mode: "tree" | "exact";
}> {
  const out: Array<{ path: string; what: string; mode: "tree" | "exact" }> = [];
  const add = (path: string, what: string, mode: "tree" | "exact") => {
    if (path) out.push({ path, what, mode });
  };
  try {
    add(tidyDir(Zotero.DataDirectory.dir), "your Zotero data folder", "tree");
  } catch {
    // No data directory to compare against; the folder checks below still run.
  }
  add(tidyDir(getPref("stagingDir") || ""), "your staging folder", "exact");
  add(
    tidyDir(getPref("sourceDir") || ""),
    "the folder new PDFs are dropped in",
    "exact",
  );
  add(
    tidyDir(getPref("intakeDir") || ""),
    "the folder intake last read",
    "exact",
  );
  return out;
}

/**
 * Where exported copies go: whatever was chosen in the export window, else
 * the export folder from settings, else a subfolder of staging.
 *
 * A chosen folder is refused if it is the staging folder, the drop folder, or
 * anywhere inside the Zotero data folder. Those hold the clean originals under
 * the same names the export writes, and both writes here overwrite without
 * asking, so pointing the export at one of them would replace the originals
 * with annotated copies. The default -- a subfolder of staging -- is beside
 * those files rather than among them, and stays allowed.
 *
 * The preference is still called mirrorDir: renaming the feature should not
 * silently discard a folder someone already chose.
 */
export function exportDir(): string {
  const chosen = tidyDir(getPref("annotationsDir") || "");
  if (chosen) return checkedDir(chosen);
  const explicit = tidyDir(getPref("mirrorDir") || "");
  if (explicit) return checkedDir(explicit);
  const staging = tidyDir(getPref("stagingDir") || "");
  if (!staging) {
    throw new Error(
      "Choose a folder here, or set a staging or export folder in Imprint settings.",
    );
  }
  return PathUtils.join(staging, "Annotated");
}

/** The folder, or an error naming what it collides with. */
function checkedDir(dir: string): string {
  for (const { path, what, mode } of protectedDirs()) {
    const clash =
      mode === "tree"
        ? isWithin(dir, path)
        : dir.toLowerCase() === path.toLowerCase();
    if (clash) {
      throw new Error(
        `That folder is ${what}, which holds your only clean copies — ` +
          "exported files are named the same way and would replace them. " +
          "Choose a folder outside it.",
      );
    }
  }
  return dir;
}

/** Year as Zotero parses it, or "" when the item has no usable date. */
function yearOf(item: Zotero.Item): string {
  const raw = item.getField("date");
  if (!raw) return "";
  const parsed = Zotero.Date.strToDate(raw as string);
  return parsed?.year ? String(parsed.year) : "";
}

function targetStem(attachment: Zotero.Item): string {
  const parent = attachment.parentItem;
  if (!parent) return attachment.key;
  const surnames = parent
    .getCreators()
    .map((c) => c.lastName || c.firstName || "")
    .filter(Boolean);
  const title =
    (parent.getField("title") as string) ||
    (parent.getField("caseName") as string) ||
    "";
  const name = canonicalName(surnames, yearOf(parent), title);
  return name ? name.replace(/\.pdf$/i, "") : attachment.key;
}

/** Newest annotation timestamp on an attachment, epoch ms; 0 if none. */
function newestAnnotation(annotations: Zotero.Item[]): number {
  let newest = 0;
  for (const a of annotations) {
    const d = Zotero.Date.sqlToDate(a.dateModified, true);
    if (d && d.getTime() > newest) newest = d.getTime();
  }
  return newest;
}

/**
 * Every stored PDF attachment carrying annotations, with whether its exported
 * copy is missing, stale or current.
 *
 * Staleness compares each target file's own timestamp against the newest
 * annotation on that attachment. There is no bookkeeping file to go wrong, so
 * this stays right after a restore, a manual delete, or an export that was
 * started and cancelled. It also re-reads correctly when the chosen output
 * changes: asking for lists instead of PDFs asks about different files.
 */
export async function scan(options: ExportOptions): Promise<ExportRecord[]> {
  beginRun();
  const dir = exportDir();
  const libraryID = Zotero.Libraries.userLibraryID;
  const allowed = options.collectionID
    ? itemsInCollection(options.collectionID)
    : null;

  const items = await Zotero.Items.getAll(libraryID, false, false);

  // Stored copies only. A linked file is already a file on disk that the user
  // manages; writing an annotated twin of it beside the original would be a
  // surprise, and Zotero does not own that path.
  const stored: number[] = [
    Zotero.Attachments.LINK_MODE_IMPORTED_FILE,
    Zotero.Attachments.LINK_MODE_IMPORTED_URL,
  ];

  const records: ExportRecord[] = [];
  for (const item of items) {
    if (stopRequested()) break;
    if (item.deleted) continue;
    if (!item.isPDFAttachment()) continue;
    if (!item.parentItemID) continue;
    if (!stored.includes(item.attachmentLinkMode)) continue;
    // Collections hold the parent item; the attachment itself is checked too
    // because a stray attachment can be filed on its own.
    if (allowed && !allowed.has(item.parentItemID) && !allowed.has(item.id)) {
      continue;
    }

    const annotations = item.getAnnotations();
    if (!annotations.length) continue;

    const stem = targetStem(item);
    records.push({
      itemID: item.id,
      key: item.key,
      stem,
      name: `${stem}.pdf`,
      pdfPath: "",
      listPath: "",
      title: cleanField(item.parentItem?.getField("title") || ""),
      annotations: annotations.length,
      newest: newestAnnotation(annotations),
      status: "not written",
    });
  }

  records.sort((a, b) =>
    a.stem.toLowerCase().localeCompare(b.stem.toLowerCase()),
  );
  disambiguate(
    records,
    await foreignStems(dir, new Set(records.map((r) => r.stem))),
  );

  const ext = extensionFor(options.format);
  for (const rec of records) {
    rec.name = `${rec.stem}.pdf`;
    rec.pdfPath = PathUtils.join(dir, rec.name);
    rec.listPath = PathUtils.join(dir, `${rec.stem}.${ext}`);
    rec.status = await statusOf(rec, options.what);
  }
  return records;
}

/**
 * Stems already sitting in the export folder that this scan does not account
 * for -- files put there by something other than this export, or by an export
 * of a different collection. A disambiguated name must not land on one of
 * them: the numbered names are the ones most likely to collide with a file
 * someone else wrote, and unlike a record's own target they carry no claim to
 * that path.
 */
async function foreignStems(
  dir: string,
  ours: Set<string>,
): Promise<Set<string>> {
  const foreign = new Set<string>();
  let children: string[];
  try {
    children = await IOUtils.getChildren(dir);
  } catch {
    // Nothing there yet, which is the common case on a first export.
    return foreign;
  }
  for (const path of children) {
    const stem = PathUtils.filename(path).replace(/\.[^.]+$/, "");
    if (!ours.has(stem)) foreign.add(stem);
  }
  return foreign;
}

/**
 * Two attachments can render to the same filename -- the same paper held
 * twice, or two papers by one author in one year with titles that truncate to
 * the same string. Without this the second export silently overwrites the
 * first and the folder quietly holds one fewer paper than the library does.
 *
 * `reserved` holds names already in the folder that belong to nobody in this
 * scan; a numbered name skips over those rather than replacing one.
 */
function disambiguate(records: ExportRecord[], reserved: Set<string>) {
  const taken = new Set<string>();
  for (const rec of records) {
    if (!taken.has(rec.stem)) {
      taken.add(rec.stem);
      continue;
    }
    let n = 2;
    let candidate = `${rec.stem} (${n})`;
    while (taken.has(candidate) || reserved.has(candidate)) {
      n += 1;
      candidate = `${rec.stem} (${n})`;
    }
    rec.stem = candidate;
    taken.add(candidate);
  }
}

/** Every file this record is supposed to produce, given the chosen output. */
function targetsFor(rec: ExportRecord, what: ExportWhat): string[] {
  const out: string[] = [];
  if (what !== "list") out.push(rec.pdfPath);
  if (what !== "pdf") out.push(rec.listPath);
  return out;
}

/**
 * The worst state across the files this record should produce: missing beats
 * stale beats current, so "current" always means every file is there and
 * newer than the reading in it.
 */
async function statusOf(
  rec: ExportRecord,
  what: ExportWhat,
): Promise<ExportStatus> {
  let stale = false;
  for (const path of targetsFor(rec, what)) {
    let modified: number;
    try {
      modified = (await IOUtils.stat(path)).lastModified ?? 0;
    } catch {
      return "not written";
    }
    if (modified < rec.newest) stale = true;
  }
  return stale ? "out of date" : "current";
}

export interface ExportResult {
  /** True when the user stopped the run part-way. */
  stopped: boolean;
  written: number;
  annotations: number;
  failed: number;
  log: string[];
}

/**
 * Write the given records. A dry run reports what it would do and touches
 * nothing.
 */
export async function exportRecords(
  records: ExportRecord[],
  options: ExportOptions & { dryRun: boolean },
): Promise<ExportResult> {
  beginRun();
  const result: ExportResult = {
    stopped: false,
    written: 0,
    annotations: 0,
    failed: 0,
    log: [],
  };

  if (!options.dryRun && records.length) {
    await IOUtils.makeDirectory(exportDir(), { createAncestors: true });
  }

  const wantPdf = options.what !== "list";
  const wantList = options.what !== "pdf";

  for (const rec of records) {
    if (stopRequested()) {
      result.stopped = true;
      result.log.push("stopped — the records below this were not written");
      break;
    }
    if (options.dryRun) {
      for (const path of targetsFor(rec, options.what)) {
        result.log.push(`would write ${PathUtils.filename(path)}`);
      }
      continue;
    }
    try {
      if (wantPdf) {
        // (itemID, path). isPriority, password and transfer are left off on
        // purpose -- transfer would delete the annotations from the library
        // after writing them into the file.
        const n = await Zotero.PDFWorker.export(rec.itemID, rec.pdfPath);
        result.written += 1;
        result.annotations += typeof n === "number" ? n : 0;
        result.log.push(`wrote ${rec.name}  (${n} annotations)`);
      }
      if (wantList) {
        const item = Zotero.Items.get(rec.itemID);
        if (!item)
          throw new Error("the attachment is no longer in the library");
        const entries = collect(item);
        const text = render(rec.title || rec.stem, entries, options.format);
        await IOUtils.writeUTF8(rec.listPath, text);
        result.written += 1;
        // Only counted once per paper when both files are written, because
        // it is the same reading in both.
        if (!wantPdf) result.annotations += entries.length;
        result.log.push(
          `wrote ${PathUtils.filename(rec.listPath)}  (${entries.length} annotations)`,
        );
      }
    } catch (e) {
      result.failed += 1;
      result.log.push(`ERROR ${rec.stem}: ${e}`);
    }
  }
  return result;
}
