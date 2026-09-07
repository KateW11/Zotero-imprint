/**
 * Filename conventions, ported from the Python intake tool so that files this
 * plugin writes match the ones already in the folder.
 */

/**
 * Inline markup a publisher deposits inside a Crossref title.
 *
 * Crossref returns what the publisher filed, which is JATS, so a title arrives
 * as text with elements still in it:
 *
 *     Association of Age, Sex and\n      <scp>ASA</scp>\n      Physical Status...
 *     Forecasting Excessive Anesthesia Depth Using EEG <i>a</i> -Spindle...
 *
 * Left in, they reach two places at once: the item's title field, and -- via
 * canonicalName, which builds the filename from that same string -- the name
 * of the file on disk.
 *
 * Only these named elements are removed, never "<...>" in general: a title may
 * legitimately hold a "<" ("p < 0.05"), and a blanket strip would swallow
 * everything up to the next ">".
 */
const INLINE_TAG =
  /<\/?(?:i|b|u|em|strong|sub|sup|scp|sc|small-caps|span|italic|bold|roman|monospace|underline|overline|sans-serif|styled-content|named-content|alternatives|inline-formula|tex-math|x|br|mml:[a-z-]+)\b[^>]*>/gi;

const NAMED_ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Character references, resolved after the tags are gone so that an escaped
 * "&lt;i&gt;" the author actually wrote is not then treated as markup.
 */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const code = parseInt(
          hex ? body.slice(2) : body.slice(1),
          hex ? 16 : 10,
        );
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
          return whole;
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      const named = NAMED_ENTITY[body.toLowerCase()];
      return named === undefined ? whole : named;
    },
  );
}

/**
 * A title as it should be stored and named by: no markup, no character
 * references, no stray whitespace. A newline in a title breaks YAML
 * frontmatter downstream, which is why the collapse was here to begin with.
 */
export function cleanField(s: unknown): string {
  const raw = String(s ?? "");
  const stripped = raw.replace(INLINE_TAG, "");
  const flat = decodeEntities(stripped).replace(/\s+/g, " ").trim();
  if (stripped === raw) return flat;
  // Removing a tag can leave the space that held the markup apart from the
  // next word: "EEG <i>a</i> -Spindle" flattens to "EEG a -Spindle". Close
  // that gap, but only where a tag was actually removed, and only for a hyphen
  // with a space before it and none after -- " - " used as a separator between
  // two parts of a title is left exactly as it is.
  return flat.replace(/ -(?=[^\s-])/g, "-");
}

/**
 * Last name from a possibly-full creator string, keeping lowercase particles.
 *
 * Library data is often dirty: a creator's lastName field may hold the whole
 * name ("Hilary Grimmer"). Splitting on the last token breaks "van de
 * Leemput", so walk left over any lowercase particles.
 */
/** Generational and honorific tails that are not the surname. */
const NAME_SUFFIX =
  /^(?:jr|sr|jnr|snr|ii|iii|iv|v|vi|2nd|3rd|4th|phd|md|dphil|esq)\.?$/i;

export function surnameOf(name: string): string {
  // "Grimmer, Hilary" and "van de Leemput, I.A." -- what a bad import or a
  // hand-typed entry leaves in a single name field. Everything before the
  // comma is the surname, so read it there rather than walking in from the
  // right, which stops at the comma-terminated surname and returns the
  // *given* name instead.
  const comma = (name || "").indexOf(",");
  if (comma > 0) {
    const before = name.slice(0, comma).trim();
    if (before) return before;
  }

  const toks = (name || "").split(/\s+/).filter(Boolean);
  if (toks.length <= 1) return name || "";
  // "John Smith Jr." -- the suffix is the last token, so walking in from the
  // right would return "Jr." as the surname.
  let end = toks.length;
  while (end > 1 && NAME_SUFFIX.test(toks[end - 1])) end--;
  let i = end - 1;
  // A particle chain belongs to the surname: "van de Leemput".
  while (i > 0 && /^[a-z]/.test(toks[i - 1])) i--;
  return toks.slice(i, end).join(" ");
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
