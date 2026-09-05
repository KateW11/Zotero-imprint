import { canonicalName, cleanField, surnameOf } from "../utils/naming";
import { filenameParts, titleScore } from "../utils/matching";
import { normText } from "../utils/similarity";
import { normaliseDoi } from "./pdfText";
import { folderIndex, IndexProgress } from "./folderIndex";
import { itemsInCollection } from "./intake";

/**
 * Compare a folder of PDFs against the library, both ways.
 *
 * Answers four questions nothing else answers together:
 *   folderOnly  -- a PDF you hold that the library has no item for
 *   libraryOnly -- an item with no copy in your folder, so no local backup
 *   broken      -- an attachment row whose file is not on disk: it looks
 *                  present in Zotero, opens to nothing, and will never appear
 *                  on a phone
 *   noPdf       -- an item with no PDF attached at all
 *
 * Reads only. Nothing here changes the library or the folder.
 */

const TITLE_FLOOR = 0.86;

interface LibraryItem {
  id: number;
  key: string;
  title: string;
  doi: string;
  year: string;
  creators: string[];
  pdfs: number;
  /** False when scoped to a collection and this item is outside it. */
  inScope: boolean;
}

export interface ReconcileReport {
  files: number;
  items: number;
  matched: number;
  storageChecked: boolean;
  storage: string;
  /** What the folder was compared against. */
  scope: string;
  folderOnly: Array<{ name: string; doi: string; elsewhere: string }>;
  libraryOnly: Array<{
    key: string;
    title: string;
    hasPdf: boolean;
    suggested: string;
  }>;
  broken: Array<{
    key: string;
    attachment: string;
    title: string;
    filename: string;
  }>;
  noPdf: Array<{ key: string; title: string }>;
}

export async function reconcile(
  folder: string,
  options: {
    rescanAll?: boolean;
    onProgress?: IndexProgress;
    collectionID?: number | null;
  } = {},
): Promise<ReconcileReport> {
  const libraryID = Zotero.Libraries.userLibraryID;
  const storage = PathUtils.join(Zotero.DataDirectory.dir, "storage");

  // If the storage folder itself is not there, every attachment would be
  // reported missing. That is a wrong data folder, not 148 broken files.
  let storageChecked = false;
  try {
    storageChecked = (await IOUtils.stat(storage)).type === "directory";
  } catch {
    storageChecked = false;
  }

  const all = await Zotero.Items.getAll(libraryID, false, false);
  const items = new Map<number, LibraryItem>();
  const broken: ReconcileReport["broken"] = [];

  // The whole library is always indexed, even when the comparison is scoped
  // to one collection: a file whose item sits elsewhere in the library is a
  // different finding from one the library has never heard of.
  const scopeIDs = options.collectionID
    ? itemsInCollection(options.collectionID)
    : null;
  const collection = options.collectionID
    ? Zotero.Collections.get(options.collectionID)
    : null;

  for (const item of all) {
    if (item.deleted || !item.isRegularItem()) continue;
    items.set(item.id, {
      id: item.id,
      inScope: !scopeIDs || scopeIDs.has(item.id),
      key: item.key,
      title:
        (item.getField("title") as string) ||
        (item.getField("caseName") as string) ||
        "",
      doi: normaliseDoi(item.getField("DOI")),
      year: String(item.getField("date") || "").slice(0, 4),
      creators: item.getCreators().map((c) => c.lastName || c.firstName || ""),
      pdfs: 0,
    });
  }

  for (const item of all) {
    if (item.deleted || !item.isPDFAttachment() || !item.parentItemID) continue;
    const parent = items.get(item.parentItemID);
    if (!parent) continue;
    parent.pdfs += 1;
    if (!parent.inScope) continue;
    if (!storageChecked) continue;
    if (await item.fileExists()) continue;
    broken.push({
      key: parent.key,
      attachment: item.key,
      title: cleanField(parent.title).slice(0, 90),
      filename: item.attachmentFilename || "",
    });
  }

  const files = await folderIndex(folder, options);

  const byDoi = new Map<string, LibraryItem>();
  const byAuthorYear = new Map<string, LibraryItem[]>();
  for (const it of items.values()) {
    if (it.doi && !byDoi.has(it.doi)) byDoi.set(it.doi, it);
    if (it.creators.length && /^\d{4}$/.test(it.year)) {
      const key = normText(surnameOf(it.creators[0])) + "|" + it.year;
      const list = byAuthorYear.get(key);
      if (list) list.push(it);
      else byAuthorYear.set(key, [it]);
    }
  }

  const matchedFiles = new Set<string>();
  const matchedItems = new Set<string>();
  /** Files matched to an item that exists, but outside the chosen collection. */
  const outOfScope = new Map<string, string>();

  for (const f of files) {
    let hit: LibraryItem | null =
      (f.doi && byDoi.get(normaliseDoi(f.doi))) || null;

    if (!hit) {
      let best: LibraryItem | null = null;
      let score = 0;
      for (const it of items.values()) {
        const s = titleScore(f.name, it.title);
        if (s > score) {
          best = it;
          score = s;
        }
      }
      if (score >= TITLE_FLOOR) hit = best;
    }

    if (!hit) {
      // Last pass: first author and year. Rescues a filename whose title was
      // truncated hard or spelled differently from the item.
      const { first, year } = filenameParts(f.name);
      const candidates = year
        ? byAuthorYear.get(normText(surnameOf(first)) + "|" + year) || []
        : [];
      if (candidates.length === 1) hit = candidates[0];
    }

    if (hit && hit.inScope) {
      matchedFiles.add(f.name);
      matchedItems.add(hit.key);
    } else if (hit) {
      outOfScope.set(f.name, cleanField(hit.title).slice(0, 60));
    }
  }

  const folderOnly = files
    .filter((f) => !matchedFiles.has(f.name))
    .map((f) => ({
      name: f.name,
      doi: f.doi || "",
      elsewhere: outOfScope.get(f.name) || "",
    }));

  const libraryOnly: ReconcileReport["libraryOnly"] = [];
  const noPdf: ReconcileReport["noPdf"] = [];
  for (const it of items.values()) {
    if (!it.inScope) continue;
    const title = cleanField(it.title).slice(0, 90);
    if (!it.pdfs) noPdf.push({ key: it.key, title });
    if (!matchedItems.has(it.key)) {
      libraryOnly.push({
        key: it.key,
        title,
        hasPdf: it.pdfs > 0,
        suggested:
          canonicalName(it.creators.map(surnameOf), it.year, it.title) || "",
      });
    }
  }

  const byTitle = (a: { title: string }, b: { title: string }) =>
    a.title.toLowerCase().localeCompare(b.title.toLowerCase());

  const inScopeCount = [...items.values()].filter((i) => i.inScope).length;

  return {
    files: files.length,
    items: inScopeCount,
    scope: collection ? collection.name : "the library",
    matched: matchedFiles.size,
    storageChecked,
    storage,
    folderOnly: folderOnly.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    ),
    libraryOnly: libraryOnly.sort(byTitle),
    broken: broken.sort(byTitle),
    noPdf: noPdf.sort(byTitle),
  };
}

/** The report as Markdown, for pasting somewhere. */
export function asMarkdown(rep: ReconcileReport, folder: string): string {
  const L: string[] = [
    "# Library reconciliation",
    "",
    "Folder: `" + folder + "`",
    "Compared against: " + rep.scope,
    "",
    `${rep.files} PDFs in the folder · ${rep.items} items in ${rep.scope} · ${rep.matched} matched`,
    "",
  ];

  if (!rep.storageChecked) {
    L.push(
      "> Storage folder not found at `" +
        rep.storage +
        "`, so attachment files were not checked. Is the Zotero data folder set correctly?",
      "",
    );
  }

  const block = (title: string, rows: unknown[], render: (r: any) => string) => {
    L.push(`## ${title} (${rows.length})`, "");
    if (!rows.length) L.push("None.");
    else L.push(...rows.map((r) => "- " + render(r)));
    L.push("");
  };

  const withDoi = (r: any) => r.name + (r.doi ? " — " + r.doi : "");
  block(
    "In the folder, not in the library at all",
    rep.folderOnly.filter((r) => !r.elsewhere),
    withDoi,
  );
  const elsewhere = rep.folderOnly.filter((r) => r.elsewhere);
  if (elsewhere.length) {
    block(
      `In the folder and in the library, but not in ${rep.scope}`,
      elsewhere,
      (r) => withDoi(r) + "  (" + r.elsewhere + ")",
    );
  }
  block(`In ${rep.scope}, no copy in the folder`, rep.libraryOnly, (r) =>
    `[${r.key}] ${r.title}` + (r.hasPdf ? "" : "  (no PDF in Zotero either)"),
  );
  block("Attachment rows whose file is missing on disk", rep.broken, (r) =>
    `[${r.key}] ${r.title} — ${r.filename}`,
  );
  block("Items with no PDF attached", rep.noPdf, (r) => `[${r.key}] ${r.title}`);

  return L.join("\n");
}
