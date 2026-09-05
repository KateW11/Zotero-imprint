import { getPref } from "../utils/prefs";
import { canonicalName, cleanField } from "../utils/naming";

/**
 * Mirroring annotated PDFs out of Zotero.
 *
 * Zotero keeps annotations in its database, not in the file, so every PDF in
 * the storage folder is the clean original -- a copy of that folder backs up
 * the papers and none of the reading. This writes copies with the annotations
 * embedded as standard PDF annotations, which any reader opens and which
 * Zotero can read back if they are ever re-imported.
 *
 * Nothing in the library is modified. The export reads an attachment and its
 * annotations and writes a separate file; the "transfer" argument, which would
 * move the annotations out of the library, is deliberately never passed.
 */

export type MirrorStatus = "not written" | "out of date" | "current";

export interface MirrorRecord {
  itemID: number;
  key: string;
  /** Target filename. */
  name: string;
  /** Absolute target path. */
  path: string;
  title: string;
  annotations: number;
  /** Newest annotation on this attachment, epoch ms. */
  newest: number;
  status: MirrorStatus;
}

function expandPath(p: string): string {
  const t = (p || "").trim();
  if (!t.startsWith("~")) return t;
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  return t.replace(/^~/, home);
}

/**
 * Where annotated copies go. Defaults to a subfolder of staging so it can
 * never overwrite the clean originals sitting next to it.
 */
export function mirrorDir(): string {
  const explicit = expandPath(getPref("mirrorDir") || "");
  if (explicit) return explicit;
  const staging = expandPath(getPref("stagingDir") || "");
  if (!staging) {
    throw new Error(
      "Set either a staging folder or a mirror folder in Imprint settings.",
    );
  }
  return PathUtils.join(staging, "Annotated");
}

/** Year as Zotero parses it, or "" when the item has no usable date. */
function yearOf(item: Zotero.Item): string {
  const raw = item.getField("date");
  if (!raw) return "";
  const parsed = Zotero.Date.strToDate(raw as string);
  return parsed?.year ? String(parsed.year) : "";
}

function targetName(attachment: Zotero.Item): string {
  const parent = attachment.parentItem;
  if (!parent) return `${attachment.key}.pdf`;
  const surnames = parent
    .getCreators()
    .map((c) => c.lastName || c.firstName || "")
    .filter(Boolean);
  const title =
    (parent.getField("title") as string) ||
    (parent.getField("caseName") as string) ||
    "";
  return (
    canonicalName(surnames, yearOf(parent), title) || `${attachment.key}.pdf`
  );
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
 * Every stored PDF attachment carrying annotations, with whether its mirrored
 * copy is missing, stale or current.
 *
 * Staleness compares the mirrored file's own timestamp against the newest
 * annotation on that attachment. There is no bookkeeping file to go wrong, so
 * this stays right after a restore, a manual delete, or an export that was
 * started and cancelled.
 */
export async function scan(): Promise<MirrorRecord[]> {
  const dir = mirrorDir();
  const libraryID = Zotero.Libraries.userLibraryID;

  const items = await Zotero.Items.getAll(libraryID, false, false);

  // Stored copies only. A linked file is already a file on disk that the user
  // manages; writing an annotated twin of it beside the original would be a
  // surprise, and Zotero does not own that path.
  const stored: number[] = [
    Zotero.Attachments.LINK_MODE_IMPORTED_FILE,
    Zotero.Attachments.LINK_MODE_IMPORTED_URL,
  ];

  const records: MirrorRecord[] = [];
  for (const item of items) {
    if (item.deleted) continue;
    if (!item.isPDFAttachment()) continue;
    if (!item.parentItemID) continue;
    if (!stored.includes(item.attachmentLinkMode)) continue;

    const annotations = item.getAnnotations();
    if (!annotations.length) continue;

    records.push({
      itemID: item.id,
      key: item.key,
      name: targetName(item),
      path: "",
      title: cleanField(item.parentItem?.getField("title") || "").slice(0, 90),
      annotations: annotations.length,
      newest: newestAnnotation(annotations),
      status: "not written",
    });
  }

  records.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  disambiguate(records);

  for (const rec of records) {
    rec.path = PathUtils.join(dir, rec.name);
    rec.status = await statusOf(rec.path, rec.newest);
  }
  return records;
}

/**
 * Two attachments can render to the same filename -- the same paper held
 * twice, or two papers by one author in one year with titles that truncate to
 * the same string. Without this the second export silently overwrites the
 * first and the folder quietly holds one fewer paper than the library does.
 */
function disambiguate(records: MirrorRecord[]) {
  const taken = new Set<string>();
  for (const rec of records) {
    if (!taken.has(rec.name)) {
      taken.add(rec.name);
      continue;
    }
    const stem = rec.name.replace(/\.pdf$/i, "");
    let n = 2;
    let candidate = `${stem} (${n}).pdf`;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${stem} (${n}).pdf`;
    }
    rec.name = candidate;
    taken.add(candidate);
  }
}

async function statusOf(path: string, newest: number): Promise<MirrorStatus> {
  let modified: number;
  try {
    modified = (await IOUtils.stat(path)).lastModified ?? 0;
  } catch {
    return "not written";
  }
  return modified < newest ? "out of date" : "current";
}

export interface ExportResult {
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
  records: MirrorRecord[],
  options: { dryRun: boolean },
): Promise<ExportResult> {
  const result: ExportResult = {
    written: 0,
    annotations: 0,
    failed: 0,
    log: [],
  };

  if (!options.dryRun && records.length) {
    await IOUtils.makeDirectory(mirrorDir(), { createAncestors: true });
  }

  for (const rec of records) {
    if (options.dryRun) {
      result.log.push(`would write ${rec.name}`);
      continue;
    }
    try {
      // (itemID, path). isPriority, password and transfer are left off on
      // purpose -- transfer would delete the annotations from the library
      // after writing them into the file.
      const n = await Zotero.PDFWorker.export(rec.itemID, rec.path);
      result.written += 1;
      result.annotations += typeof n === "number" ? n : 0;
      result.log.push(`wrote ${rec.name}  (${n} annotations)`);
    } catch (e) {
      result.failed += 1;
      result.log.push(`ERROR ${rec.name}: ${e}`);
    }
  }
  return result;
}
