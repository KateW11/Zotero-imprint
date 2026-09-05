/**
 * Filename conventions, ported from the Python intake tool so that files this
 * plugin writes match the ones already in the folder.
 */

/** Collapse whitespace. A newline in a title breaks YAML frontmatter downstream. */
export function cleanField(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Last name from a possibly-full creator string, keeping lowercase particles.
 *
 * Library data is often dirty: a creator's lastName field may hold the whole
 * name ("Hilary Grimmer"). Splitting on the last token breaks "van de
 * Leemput", so walk left over any lowercase particles.
 */
export function surnameOf(name: string): string {
  const toks = (name || "").split(/\s+/).filter(Boolean);
  if (toks.length <= 1) return name || "";
  let i = toks.length - 1;
  while (i > 0 && /^[a-z]/.test(toks[i - 1])) i--;
  return toks.slice(i).join(" ");
}

/** Zotero-style author segment: "A", "A and B", or "A et al.". */
export function authorField(surnames: string[]): string {
  const s = surnames.filter(Boolean);
  if (!s.length) return "";
  if (s.length === 1) return s[0];
  if (s.length === 2) return `${s[0]} and ${s[1]}`;
  return `${s[0]} et al.`;
}

/**
 * "Author - YYYY - Title.pdf", or null when a component is missing.
 *
 * Truncates the title at a word boundary, matching Zotero's own file-naming
 * template. Only "/" is replaced, because it is the one character a POSIX
 * filename cannot hold; colons and question marks are kept, because real
 * libraries keep them.
 */
export function canonicalName(
  surnames: string[],
  year: string,
  title: string,
  maxTitle = 100,
): string | null {
  let t = cleanField((title || "").replace(/\//g, "-"));
  if (t.length > maxTitle) {
    t = t.slice(0, maxTitle).replace(/\s+\S*$/, "");
  }
  t = t.replace(/[\s.,;:-]+$/, "");
  const a = authorField(surnames.map(surnameOf));
  if (!a || !year || !t) return null;
  return `${a} - ${year} - ${t}.pdf`;
}
