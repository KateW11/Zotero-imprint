import { getPref } from "../utils/prefs";
import { canonicalName, cleanField } from "../utils/naming";
import { titleScore } from "../utils/matching";
import { normText } from "../utils/similarity";
import { isSupplementDoi, normaliseDoi, supplementParentDoi } from "./pdfText";
import { flushCache } from "./crossref";
import {
  ApplyResult,
  Existing,
  IntakeRow,
  IntakeStatus,
  libraryIndex,
  resolve,
} from "./intake";
import { readJSON, writeJSON } from "../utils/store";
import { beginRun, stopRequested } from "../utils/cancel";

/**
 * Intake for a folder of freshly downloaded PDFs.
 *
 * Each file is identified by the DOI printed inside it, checked against the
 * library, then imported and moved into the staging folder under a name that
 * matches the convention already there.
 *
 * The library writes happen first and the files are moved last, so a failure
 * partway through leaves the source folder exactly as it was.
 */

const MOVES_FILE = "moves.json";
const TITLE_FLOOR = 0.72;

function expandPath(p: string): string {
  const t = (p || "").trim();
  const full = t.startsWith("~")
    ? t.replace(/^~/, Services.dirsvc.get("Home", Ci.nsIFile).path)
    : t;
  // A trailing separator would make PathUtils.join produce a doubled one,
  // and two spellings of the same folder never compare equal.
  return full.length > 1 ? full.replace(/\/+$/, "") : full;
}

/**
 * Where loose PDFs are read from: whatever was chosen in the intake window,
 * else the folder from settings. The window-level choice is its own
 * preference so reading one folder for one run does not move the setting.
 */
export function sourceDir(): string {
  const chosen = expandPath(getPref("intakeDir") || "");
  if (chosen) return chosen;
  const dir = expandPath(getPref("sourceDir") || "");
  if (!dir) {
    throw new Error(
      "Choose a folder here, or set the folder new PDFs are dropped in, in Imprint settings.",
    );
  }
  return dir;
}

export function stagingDir(): string {
  const dir = expandPath(getPref("stagingDir") || "");
  if (!dir) {
    throw new Error("Set the staging folder in Imprint settings.");
  }
  return dir;
}

export interface ScanProgress {
  (done: number, total: number, name: string): void;
}

export interface ScanOptions {
  onProgress?: ScanProgress;
  /** Read this folder instead of the configured source folder. */
  folder?: string;
  /** Only these filenames, when another window has picked out a subset. */
  only?: string[] | null;
}

export async function scan(options: ScanOptions = {}): Promise<IntakeRow[]> {
  beginRun();
  const folder = expandPath(options.folder || "") || sourceDir();
  const index = await libraryIndex();

  let paths = (await IOUtils.getChildren(folder)).filter((p) =>
    /\.pdf$/i.test(p),
  );
  if (options.only?.length) {
    const wanted = new Set(options.only.map((n) => n.toLowerCase()));
    paths = paths.filter((p) =>
      wanted.has(PathUtils.filename(p).toLowerCase()),
    );
  }
  paths.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const rows: IntakeRow[] = [];
  const seenDois = new Map<string, string>();
  let done = 0;

  for (const path of paths) {
    // Between files, never inside one: a row is either fully worked out or
    // not started.
    if (stopRequested()) break;
    const filename = PathUtils.filename(path);
    done += 1;
    options.onProgress?.(done, paths.length, filename);

    const { record, doi, doiSource, reason } = await resolve(path, filename);

    let existing: Existing | undefined = record?.DOI
      ? index.byDoi.get(normaliseDoi(record.DOI))
      : undefined;
    if (!existing && record?.title) {
      existing = index.byTitle.get(normText(record.title));
    }
    // Last pass: a filename close enough to an item's title. Catches a paper
    // held under a differently spelled title from the one Crossref returns.
    if (!existing && !record) {
      let best: Existing | undefined;
      let score = 0;
      for (const [title, entry] of index.byTitle) {
        const s = titleScore(filename, title);
        if (s > score) {
          best = entry;
          score = s;
        }
      }
      if (score >= TITLE_FLOOR) existing = best;
    }

    let status: IntakeStatus;
    let why = reason;
    let included: boolean;

    const dedupeKey = normaliseDoi(record?.DOI || "");
    if (dedupeKey && seenDois.has(dedupeKey)) {
      // Two copies of one paper in the same batch. Held back rather than
      // creating a twin or double-attaching. It reads as its own status
      // rather than "needs you": the reason is known and specific, and a row
      // that says why it was held back is not the same as one that says
      // nothing could be decided.
      status = "duplicate";
      why = `the same paper as ${seenDois.get(dedupeKey)}, earlier in this batch`;
      included = false;
    } else if (!record) {
      status = "needs you";
      included = false;
    } else if (isSupplementDoi(record.DOI)) {
      // APA and others mint a separate DOI for supplementary material, and the
      // supplement's PDF carries it. Crossref answers for that DOI with a
      // record of an ordinary type, so without this the file reads as a paper
      // the library does not hold -- and intake would create a standalone item
      // titled "Supplemental Material for ..." and file it as a paper. The
      // library side has always applied this test; the folder side did not.
      const parentDoi = supplementParentDoi(record.DOI);
      const parent = parentDoi ? index.byDoi.get(parentDoi) : undefined;
      status = "supplement";
      why = parent
        ? `supplementary material for "${cleanField(parent.title).slice(0, 60)}", which your library already holds`
        : `supplementary material for ${parentDoi}, which is not in your library`;
      included = false;
    } else if (!existing) {
      status = "new";
      included = true;
    } else if (existing.hasPdf) {
      status = "already has PDF";
      why = "your library already holds this paper with a PDF on it";
      included = false;
    } else {
      status = "attach";
      included = true;
    }

    if (dedupeKey && !seenDois.has(dedupeKey))
      seenDois.set(dedupeKey, filename);

    rows.push({
      source: "folder",
      itemID: 0,
      key: "",
      path,
      filename,
      targetName: record
        ? canonicalName(record.surnames, record.year, record.title) || filename
        : filename,
      status,
      doi,
      doiSource,
      record,
      existingID: existing?.id ?? null,
      existingTitle: existing?.title ?? null,
      parented: false,
      reason: why,
      included,
    });
  }

  await flushCache();
  return rows;
}

/** setField throws on a field the item type does not have. */
function setIfValid(item: Zotero.Item, field: string, value: string) {
  if (!value) return;
  try {
    item.setField(field, value);
  } catch {
    Zotero.debug(`Imprint: ${item.itemType} has no ${field} field, skipped`);
  }
}

function buildItem(row: IntakeRow): Zotero.Item {
  const record = row.record!;
  const item = new Zotero.Item(record.itemType as any);
  setIfValid(item, "title", record.title);
  setIfValid(item, "DOI", record.DOI);
  setIfValid(item, "date", record.date);
  setIfValid(
    item,
    record.itemType === "preprint" ? "repository" : "publicationTitle",
    record.publicationTitle,
  );
  setIfValid(item, "volume", record.volume);
  setIfValid(item, "issue", record.issue);
  setIfValid(item, "pages", record.pages);
  if (record.creators.length) item.setCreators(record.creators as any);
  return item;
}

/**
 * A name not already taken in the staging folder, or by this batch.
 *
 * `ignore` is the file's own current name, when the file is already sitting
 * in the staging folder: without it a file reconciled in place would collide
 * with itself and be renamed "(duplicate)".
 */
async function freeName(
  dir: string,
  wanted: string,
  taken: Set<string>,
  ignore: string | null = null,
): Promise<string> {
  const stem = wanted.replace(/\.pdf$/i, "");
  const candidates = [
    wanted,
    `${stem} (duplicate).pdf`,
    ...Array.from({ length: 20 }, (_, i) => `${stem} (${i + 2}).pdf`),
  ];
  for (const name of candidates) {
    if (taken.has(name.toLowerCase())) continue;
    if (ignore && name.toLowerCase() === ignore.toLowerCase()) return name;
    if (!(await IOUtils.exists(PathUtils.join(dir, name)))) return name;
  }
  return `${stem} (${Date.now()}).pdf`;
}

export async function apply(
  rows: IntakeRow[],
  options: { dryRun: boolean; collectionID?: number | null },
): Promise<ApplyResult> {
  const result: ApplyResult = {
    stopped: false,
    created: 0,
    attached: 0,
    renamed: 0,
    filed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    log: [],
  };

  beginRun();
  const staging = stagingDir();
  const collection = options.collectionID
    ? Zotero.Collections.get(options.collectionID)
    : null;
  const taken = new Set<string>();
  const moves: Array<{ from: string; to: string; at: string }> = [];

  if (!options.dryRun) {
    await IOUtils.makeDirectory(staging, { createAncestors: true });
  }

  for (const row of rows) {
    if (stopRequested()) {
      result.stopped = true;
      result.log.push("stopped — the rows below this were not touched");
      break;
    }
    if (row.source !== "folder" || !row.included || !row.record) continue;
    result.log.push(row.filename);

    try {
      // Intake normally moves a file out of the drop folder into staging.
      // Reconcile can send files that are already in staging -- those are
      // imported and then left exactly where they are.
      const alreadyStaged =
        row.path === PathUtils.join(staging, PathUtils.filename(row.path!));
      const target = await freeName(
        staging,
        row.targetName || row.filename,
        taken,
        alreadyStaged ? row.filename : null,
      );
      taken.add(target.toLowerCase());
      const destination = PathUtils.join(staging, target);
      const staysPut = destination === row.path;

      let parent: Zotero.Item | null = row.existingID
        ? Zotero.Items.get(row.existingID) || null
        : null;

      // One PDF per item, re-checked rather than trusted from the scan.
      if (parent) {
        const hasPdf = parent
          .getAttachments()
          .map((id) => Zotero.Items.get(id))
          .some((a) => a && !a.deleted && a.isPDFAttachment());
        if (hasPdf) {
          result.skipped += 1;
          result.log.push("  skipped — that item already holds a PDF");
          continue;
        }
      }

      if (options.dryRun) {
        result.log.push(
          parent
            ? `  would attach to "${cleanField(parent.getField("title")).slice(0, 60)}"`
            : `  would create ${row.record.itemType} "${row.record.title.slice(0, 60)}"`,
        );
        if (collection) result.log.push(`  would file into ${collection.name}`);
        result.log.push(
          staysPut
            ? "  would leave the file where it is, already in staging"
            : `  would move the file to staging as ${target}`,
        );
        continue;
      }

      if (!parent) {
        parent = buildItem(row);
        if (collection) parent.addToCollection(collection.id);
        await parent.saveTx();
        result.created += 1;
        result.log.push(`  created ${row.record.itemType}`);
      } else if (collection && !parent.inCollection(collection.id)) {
        parent.addToCollection(collection.id);
        await parent.saveTx();
        result.filed += 1;
        result.log.push(`  filed into ${collection.name}`);
      }

      // Zotero copies the file into its own storage under whatever the file
      // is called at that moment, which for a publisher default is a name
      // that says nothing -- "aas70281.pdf". The move below renames the
      // original, so without the rename that follows the library would hold
      // the paper under the very name the convention exists to replace, while
      // the copy in staging read correctly. Importing still happens first, so
      // the library is complete before the original is touched.
      const attachment = await Zotero.Attachments.importFromFile({
        file: row.path!,
        parentItemID: parent.id,
      });
      result.attached += 1;
      result.log.push("  imported into Zotero");

      // Zotero sanitises the name it is given -- it drops a colon, for
      // instance -- so the stored copy matches the staged file as closely as
      // a stored name can. A failure here leaves the item and both files
      // intact and only the stored copy misnamed, so it is reported and
      // stepped over rather than failing the row.
      if (attachment && target) {
        try {
          await (attachment as any).renameAttachmentFile(target);
        } catch (e) {
          Zotero.debug(`Imprint: could not rename the stored copy: ${e}`);
          result.log.push("  note: the copy in Zotero kept its original name");
        }
      }

      // Only now move the original, so a failure above leaves the source
      // folder exactly as it was.
      if (staysPut) {
        result.log.push("  left in place, already in staging");
      } else {
        // freeName() has already guaranteed the destination is free; asking
        // the move itself to refuse means a future bug there cannot cost a
        // staged file.
        await IOUtils.move(row.path!, destination, { noOverwrite: true });
        moves.push({
          from: row.path!,
          to: destination,
          at: new Date().toISOString(),
        });
        result.renamed += 1;
        result.log.push(`  moved to staging as ${target}`);
      }
    } catch (e) {
      result.failed += 1;
      result.log.push(`  ERROR ${e}`);
    }
  }

  if (moves.length) {
    // A record of what moved where, so a batch can be put back by hand. Kept
    // in the plugin's own folder, not in any folder of the user's.
    const previous = await readJSON<typeof moves>(MOVES_FILE, []);
    await writeJSON(MOVES_FILE, [...previous.slice(-500), ...moves]);
  }

  return result;
}
