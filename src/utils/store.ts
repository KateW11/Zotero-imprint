/**
 * A small JSON file the plugin owns, under the Zotero data directory.
 *
 * Used for caches that must survive a restart: Crossref answers, and the DOI
 * read out of each file in a folder. Both are expensive to rebuild and cheap
 * to keep.
 */

export function pluginDir(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, "imprint");
}

export async function readJSON<T>(name: string, fallback: T): Promise<T> {
  try {
    const text = await IOUtils.readUTF8(PathUtils.join(pluginDir(), name));
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function writeJSON(name: string, value: unknown): Promise<void> {
  const dir = pluginDir();
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  // tmpPath makes the replacement atomic, so an interrupted write cannot
  // leave a truncated cache that then fails to parse on every later run.
  await IOUtils.writeUTF8(
    PathUtils.join(dir, name),
    JSON.stringify(value),
    { tmpPath: PathUtils.join(dir, name + ".tmp") },
  );
}
