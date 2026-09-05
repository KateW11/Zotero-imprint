import { readPdfFacts } from "./pdfText";
import { readJSON, writeJSON } from "../utils/store";

/**
 * Every PDF in a folder with the DOI read out of it, cached by modification
 * time and size.
 *
 * Reading the DOI is the slow part -- a second or so per file -- so the cache
 * makes a re-run instant while still noticing a file that was replaced.
 */

const CACHE_FILE = "folder-index.json";

export interface FolderFile {
  name: string;
  path: string;
  doi: string | null;
}

interface Entry {
  /** [modification time in ms, size in bytes] */
  sig: [number, number];
  doi: string | null;
}

export interface IndexProgress {
  (done: number, total: number, name: string): void;
}

export async function folderIndex(
  folder: string,
  options: { rescanAll?: boolean; onProgress?: IndexProgress } = {},
): Promise<FolderFile[]> {
  const cache = options.rescanAll
    ? {}
    : await readJSON<Record<string, Entry>>(CACHE_FILE, {});

  const paths = (await IOUtils.getChildren(folder)).filter((p) =>
    /\.pdf$/i.test(p),
  );
  paths.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const out: FolderFile[] = [];
  const next: Record<string, Entry> = {};
  let done = 0;

  for (const path of paths) {
    const name = PathUtils.filename(path);
    done += 1;
    options.onProgress?.(done, paths.length, name);

    let sig: [number, number];
    try {
      const stat = await IOUtils.stat(path);
      sig = [stat.lastModified ?? 0, stat.size ?? 0];
    } catch {
      continue;
    }

    const hit = cache[name];
    if (hit && hit.sig[0] === sig[0] && hit.sig[1] === sig[1]) {
      next[name] = hit;
      out.push({ name, path, doi: hit.doi });
      continue;
    }

    const facts = await readPdfFacts(path);
    next[name] = { sig, doi: facts.doi };
    out.push({ name, path, doi: facts.doi });
  }

  await writeJSON(CACHE_FILE, next);
  return out;
}
