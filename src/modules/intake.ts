import { cleanField } from "../utils/naming";
import { normText } from "../utils/similarity";
import { readPdfFacts } from "./pdfText";
import { accept, byDoi, CrossrefRecord, flushCache, recordFrom, search, } from "./crossref";
import { normaliseDoi } from "./pdfText";

/**
 * Intake for PDFs that are already in Zotero as standalone attachments --
 * what you get when you drag a PDF into the library.
 *
 * For each one: read the DOI printed inside the file, resolve it at Crossref,
 * then either attach it to the item you already hold or create the item it
 * belongs to, rename the stored file, and file it into a collection.
 */

export type IntakeStatus =
  /** No item for this paper: one will be created. */
  | "new"
  /** The item is in the library without a PDF: this file gets attached. */
  | "attach"
  /** The item is in the library and already holds a PDF. */
  | "already has PDF"
  /** Nothing confident enough to act on. */
  | "needs you"
  /** Already filed, and the DOI inside the file agrees with the item. */
  | "checks out"
  /** Already filed, item carries no DOI, and the file's DOI resolves. */
  | "item has no DOI"
  /** Already filed, but the file is a different paper from the item. */
  | "disagrees with the file"
  /** Already filed, and the file carries no DOI that could confirm it. */
  | "cannot verify";

export interface IntakeRow {
  /** Where this row came from. */
  source: "zotero" | "folder";
  /** Folder rows only: the file on disk, and the name it will be given. */
  path?: string;
  targetName?: string;
  itemID: number;
  key: string;
  filename: string;
  status: IntakeStatus;
  doi: string | null;
  doiSource: string | null;
  record: CrossrefRecord | null;
  existingID: number | null;
  existingTitle: string | null;
  /** True when Zotero has already filed this attachment under an item. */
  parented: boolean;
  /** Why it landed in this status, in plain words. */
  reason: string;
  /** Set false to leave a row out of the batch. */
  included: boolean;
}

export interface Existing {
  id: number;
  title: string;
  hasPdf: boolean;
}

export async function libraryIndex(): Promise<{
  byDoi: Map<string, Existing>;
  byTitle: Map<string, Existing>;
}> {
  const all = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, false, false);
  const pdfCount = new Map<number, number>();
  for (const item of all) {
    if (item.deleted || !item.isPDFAttachment() || !item.parentItemID) continue;
    pdfCount.set(item.parentItemID, (pdfCount.get(item.parentItemID) || 0) + 1);
  }

  const byDoiMap = new Map<string, Existing>();
  const byTitleMap = new Map<string, Existing>();
  for (const item of all) {
    if (item.deleted || !item.isRegularItem()) continue;
    const entry: Existing = {
      id: item.id,
      title: cleanField(item.getField("title") || ""),
      hasPdf: (pdfCount.get(item.id) || 0) > 0,
    };
    const doi = normaliseDoi(item.getField("DOI"));
    if (doi && !byDoiMap.has(doi)) byDoiMap.set(doi, entry);
    const t = normText(entry.title);
    if (t && !byTitleMap.has(t)) byTitleMap.set(t, entry);
  }
  return { byDoi: byDoiMap, byTitle: byTitleMap };
}

/**
 * Every stored PDF attachment, filed or not.
 *
 * Zotero identifies a dragged PDF on import, so loose attachments are only the
 * ones it could not identify. The ones it did file are checked too, against
 * the DOI printed inside the file -- that is the only way to catch a paper
 * filed under the wrong item.
 */
async function storedPdfAttachments(
  collectionID?: number | null,
): Promise<Zotero.Item[]> {
  const all = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, false, false);
  const stored: number[] = [
    Zotero.Attachments.LINK_MODE_IMPORTED_FILE,
    Zotero.Attachments.LINK_MODE_IMPORTED_URL,
  ];
  const allowed = collectionID ? itemsInCollection(collectionID) : null;

  return all.filter(
    (i) =>
      !i.deleted &&
      i.isPDFAttachment() &&
      stored.includes(i.attachmentLinkMode) &&
      (!allowed ||
        allowed.has(i.id) ||
        (!!i.parentItemID && allowed.has(i.parentItemID))),
  );
}

/**
 * Every item in a collection and its subcollections.
 *
 * Subcollections are included because a parent collection such as "Reading
 * Waves" usually holds no items of its own, and scanning it would otherwise
 * find nothing at all.
 */
export function itemsInCollection(collectionID: number): Set<number> {
  const out = new Set<number>();
  const seen = new Set<number>();

  const walk = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const collection = Zotero.Collections.get(id);
    if (!collection) return;
    for (const itemID of collection.getChildItems(true)) out.add(itemID);
    for (const childID of collection.getChildCollections(true)) walk(childID);
  };

  walk(collectionID);
  return out;
}

/**
 * Resolve a file to a Crossref record: the DOI printed inside it first, then a
 * bibliographic search on the filename under the strict acceptance test.
 */
export async function resolve(
  path: string,
  filename: string,
): Promise<{
  record: CrossrefRecord | null;
  doi: string | null;
  doiSource: string | null;
  /** Whether the record came from the DOI inside the file or from its name. */
  via: "doi" | "filename" | null;
  reason: string;
}> {
  const facts = await readPdfFacts(path);

  if (facts.doi) {
    const record = await byDoi(facts.doi);
    if (record) {
      return {
        record,
        doi: facts.doi,
        doiSource: facts.source,
        via: "doi",
        reason: `DOI from ${facts.source}`,
      };
    }
  }

  // No DOI, or one Crossref does not recognise -- a DOI printed across a line
  // break comes out of text extraction damaged. Fall back to the filename.
  const stem = filename.replace(/\.pdf$/i, "");
  for (const candidate of await search(stem)) {
    const verdict = accept(candidate, filename);
    if (!verdict.ok) continue;
    const record = recordFrom(candidate);
    if (record) {
      return {
        record,
        doi: facts.doi,
        doiSource: facts.source,
        via: "filename",
        reason: `filename search, ${verdict.reason}`,
      };
    }
  }

  return {
    record: null,
    doi: facts.doi,
    doiSource: facts.source,
    via: null,
    reason: facts.doi
      ? "DOI found but Crossref does not recognise it"
      : "no DOI in the file, and no confident filename match",
  };
}

export interface ScanProgress {
  (done: number, total: number, name: string): void;
}

export async function scan(
  options: { onProgress?: ScanProgress; collectionID?: number | null } = {},
): Promise<IntakeRow[]> {
  const attachments = await storedPdfAttachments(options.collectionID);
  const index = await libraryIndex();
  const rows: IntakeRow[] = [];

  let done = 0;
  for (const attachment of attachments) {
    const filename = attachment.attachmentFilename || attachment.key + ".pdf";
    done += 1;
    options.onProgress?.(done, attachments.length, filename);

    const path = await attachment.getFilePathAsync();
    if (!path) {
      rows.push({
        source: "zotero",
        itemID: attachment.id,
        key: attachment.key,
        filename,
        status: "needs you",
        doi: null,
        doiSource: null,
        record: null,
        existingID: null,
        existingTitle: null,
        parented: !!attachment.parentItemID,
        reason: "the attachment's file is missing on disk",
        included: false,
      });
      continue;
    }

    const { record, doi, doiSource, via, reason } = await resolve(path, filename);

    if (attachment.parentItemID) {
      rows.push(
        checkFiled(attachment, filename, record, doi, doiSource, via, reason),
      );
      continue;
    }

    let existing: Existing | undefined;
    if (record?.DOI) existing = index.byDoi.get(normaliseDoi(record.DOI));
    if (!existing && record?.title) {
      existing = index.byTitle.get(normText(record.title));
    }

    let status: IntakeStatus;
    if (!record) status = "needs you";
    else if (!existing) status = "new";
    else if (existing.hasPdf) status = "already has PDF";
    else status = "attach";

    rows.push({
      source: "zotero",
      itemID: attachment.id,
      key: attachment.key,
      filename,
      status,
      doi,
      doiSource,
      record,
      existingID: existing?.id ?? null,
      existingTitle: existing?.title ?? null,
      parented: false,
      reason:
        status === "already has PDF"
          ? "your library already holds this paper with a PDF on it"
          : reason,
      included: status === "new" || status === "attach",
    });
  }

  await flushCache();
  return rows;
}

/**
 * An attachment Zotero has already filed: is it under the right item?
 *
 * The only evidence that settles this is the DOI printed inside the file. A
 * paper filed under the wrong item looks entirely correct in the interface.
 */
function checkFiled(
  attachment: Zotero.Item,
  filename: string,
  record: CrossrefRecord | null,
  doi: string | null,
  doiSource: string | null,
  via: "doi" | "filename" | null,
  reason: string,
): IntakeRow {
  const parent = Zotero.Items.get(attachment.parentItemID as number) || null;
  const parentDoi = normaliseDoi(parent?.getField("DOI") || "");

  let status: IntakeStatus;
  let why: string;
  let included = false;

  if (via !== "doi" || !record) {
    // A record found by searching the FILENAME proves nothing about a filed
    // attachment: Zotero named that file from the item, so checking the item
    // against it is circular. Only a DOI read from inside the file is
    // independent evidence.
    status = "cannot verify";
    why = doi
      ? "the DOI inside the file is not one Crossref recognises"
      : "no DOI inside the file, so there is nothing independent to check the item against";
  } else if (/\.supp$/i.test(normaliseDoi(record.DOI))) {
    // APA and others mint a separate DOI for supplementary material, and the
    // supplement's PDF carries it. The file is not a different paper from the
    // item; it is that paper's appendix, so a disagreement would be wrong.
    status = "cannot verify";
    why = "this file is the item's supplementary material, which carries its own DOI";
  } else if (!parentDoi) {
    status = "item has no DOI";
    why = `the file's own DOI is ${record.DOI}`;
    included = true;
  } else if (parentDoi === normaliseDoi(record.DOI)) {
    status = "checks out";
    why = "the DOI inside the file matches the item";
  } else {
    status = "disagrees with the file";
    why = `the item says ${parentDoi}, the file says ${normaliseDoi(record.DOI)}`;
  }

  return {
    source: "zotero",
    itemID: attachment.id,
    key: attachment.key,
    filename,
    status,
    doi,
    doiSource,
    record,
    existingID: parent?.id ?? null,
    existingTitle: cleanField(parent?.getField("title") || ""),
    parented: true,
    reason: why,
    included,
  };
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

function buildItem(record: CrossrefRecord): Zotero.Item {
  // TYPE_MAP only ever yields item types Zotero has.
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
  if (record.creators.length) {
    item.setCreators(record.creators as any);
  }
  return item;
}

/**
 * Fill in fields the item is missing, and only those. Never overwrite a value
 * already there: what Crossref holds is not automatically better than what the
 * user has, and a silent overwrite of a corrected field is unforgivable.
 */
function fillMissing(item: Zotero.Item, record: CrossrefRecord): string[] {
  const changed: string[] = [];
  const pairs: Array<[string, string]> = [
    ["DOI", record.DOI],
    ["date", record.date],
    [
      record.itemType === "preprint" ? "repository" : "publicationTitle",
      record.publicationTitle,
    ],
    ["volume", record.volume],
    ["issue", record.issue],
    ["pages", record.pages],
  ];
  for (const [field, value] of pairs) {
    if (!value) continue;
    let current = "";
    try {
      current = String(item.getField(field) || "");
    } catch {
      continue;
    }
    if (current.trim()) continue;
    try {
      item.setField(field, value);
      changed.push(field);
    } catch {
      Zotero.debug(`Imprint: ${item.itemType} has no ${field} field, skipped`);
    }
  }
  if (!item.getCreators().length && record.creators.length) {
    item.setCreators(record.creators as any);
    changed.push("creators");
  }
  return changed;
}

export interface ApplyResult {
  created: number;
  attached: number;
  renamed: number;
  filed: number;
  updated: number;
  skipped: number;
  failed: number;
  log: string[];
}

/** What fillMissing would change, without changing it. */
function describeMissing(item: Zotero.Item, record: CrossrefRecord): string[] {
  const names: string[] = [];
  const pairs: Array<[string, string]> = [
    ["DOI", record.DOI],
    ["date", record.date],
    [
      record.itemType === "preprint" ? "repository" : "publicationTitle",
      record.publicationTitle,
    ],
    ["volume", record.volume],
    ["issue", record.issue],
    ["pages", record.pages],
  ];
  for (const [field, value] of pairs) {
    if (!value) continue;
    try {
      if (!String(item.getField(field) || "").trim()) names.push(field);
    } catch {
      // field not valid for this item type
    }
  }
  if (!item.getCreators().length && record.creators.length) names.push("creators");
  return names;
}

export async function apply(
  rows: IntakeRow[],
  options: { dryRun: boolean; collectionID?: number | null },
): Promise<ApplyResult> {
  const result: ApplyResult = {
    created: 0,
    attached: 0,
    renamed: 0,
    filed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    log: [],
  };

  const collection = options.collectionID
    ? Zotero.Collections.get(options.collectionID)
    : null;

  for (const row of rows) {
    if (row.source !== "zotero" || !row.included || !row.record) continue;
    result.log.push(row.filename);

    try {
      if (row.parented) {
        // The attachment is already filed. The only thing to do here is fill
        // in what the item is missing; anything else is the user's call.
        const item = row.existingID ? Zotero.Items.get(row.existingID) : null;
        if (!item) {
          result.failed += 1;
          result.log.push("  ERROR the parent item has gone since the scan");
          continue;
        }
        if (options.dryRun) {
          result.log.push(
            `  would fill in ${describeMissing(item, row.record).join(", ") || "nothing"}`,
          );
          continue;
        }
        const changed = fillMissing(item, row.record);
        if (changed.length) {
          await item.saveTx();
          result.updated += 1;
          result.log.push(`  filled in ${changed.join(", ")}`);
        } else {
          result.skipped += 1;
          result.log.push("  nothing missing to fill in");
        }
        continue;
      }

      let parent: Zotero.Item | null = row.existingID
        ? Zotero.Items.get(row.existingID) || null
        : null;

      // Re-check rather than trusting the scan: one PDF per item is the
      // invariant that stops a re-run double-attaching.
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
            ? `  would attach to the existing item "${cleanField(parent.getField("title")).slice(0, 60)}"`
            : `  would create ${row.record.itemType} "${row.record.title.slice(0, 60)}"`,
        );
        if (collection) result.log.push(`  would file into ${collection.name}`);
        result.log.push("  would rename the stored file to Zotero's convention");
        continue;
      }

      if (!parent) {
        parent = buildItem(row.record);
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

      const attachment = Zotero.Items.get(row.itemID);
      if (!attachment) {
        result.failed += 1;
        result.log.push("  ERROR the attachment has gone since the scan");
        continue;
      }
      attachment.parentItemID = parent.id;
      await attachment.saveTx();
      result.attached += 1;

      // Zotero's own naming template, so the file is named exactly as Zotero
      // would have named it. unique=true suffixes rather than overwriting.
      const base = Zotero.Attachments.getFileBaseNameFromItem(parent);
      const renamed = await attachment.renameAttachmentFile(
        base + ".pdf",
        false,
        true,
      );
      if (renamed === true) {
        result.renamed += 1;
        result.log.push(`  renamed to ${base}.pdf`);
      } else {
        result.log.push(`  could not rename the file (code ${renamed})`);
      }
    } catch (e) {
      result.failed += 1;
      result.log.push(`  ERROR ${e}`);
    }
  }

  return result;
}

/**
 * Collections as a flat list of full paths, so a nested collection reads as
 * "Reading Waves / Wave 2" rather than an ambiguous "Wave 2".
 */
export function collections(): Array<{ id: number; path: string }> {
  const all = Zotero.Collections.getByLibrary(
    Zotero.Libraries.userLibraryID,
    true,
  );
  const byID = new Map(all.map((c) => [c.id, c]));

  const pathOf = (c: Zotero.Collection): string => {
    const parts = [c.name];
    let cursor = c;
    // A malformed parent chain would otherwise loop forever.
    for (let depth = 0; depth < 20 && cursor.parentID; depth += 1) {
      const parent = byID.get(cursor.parentID);
      if (!parent) break;
      parts.unshift(parent.name);
      cursor = parent;
    }
    return parts.join(" / ");
  };

  return all
    .map((c) => ({ id: c.id, path: pathOf(c) }))
    .sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
}
