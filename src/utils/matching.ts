import { ratio, normText } from "./similarity";

const FILENAME_SHAPE = /^(?<auth>.+?) - (?<yr>(?:19|20)\d\d) - (?<title>.+)$/;

/** (first surname, year, title portion) from "Author - Year - Title.pdf". */
export function filenameParts(name: string): {
  first: string;
  year: string;
  title: string;
} {
  let stem = String(name ?? "").replace(/\.pdf$/i, "");
  stem = stem.replace(/\s*\((?:duplicate|\d+)\)$/i, "");
  const m = FILENAME_SHAPE.exec(stem);
  if (!m?.groups) return { first: "", year: "", title: stem };
  // "Scheffer et al." has no space after "et al.", so splitting on it alone
  // returned the whole string -- and surnameOf() then yielded "et al.",
  // which matches no author. The author-and-year fallback was dead for
  // every multi-author paper.
  const first = m.groups.auth
    .replace(/\s+et al\.?$/i, "")
    .split(/ (?:et al\.?|and) /)[0];
  return {
    first: first.trim(),
    year: m.groups.yr,
    title: m.groups.title.trim(),
  };
}

/**
 * Filename-to-title similarity that survives both of Zotero's habits.
 *
 * Zotero names a file "Author - Year - Title" and truncates the title at 100
 * characters. Comparing the whole filename against the whole title therefore
 * scores a perfect match well below any sensible threshold: the author-year
 * prefix is noise the title does not contain, and the title carries an ending
 * the filename had to drop. A real case from a live library --
 *
 *   file  Molenaar - 2004 - A Manifesto on Psychology as Idiographic
 *         Science: Bringing the Person Back Into Scientific.pdf
 *   item  A Manifesto on Psychology as Idiographic Science: Bringing the
 *         Person Back Into Scientific Psychology, This Time Forever
 *
 * -- scores 0.805 whole against whole, and 1.000 once the prefix is dropped
 * and the title is cut to the length the filename actually had room for.
 *
 * The cut is only allowed for a filename long enough to be distinctive, so a
 * short one cannot match every title that happens to start the same way.
 */
export function titleScore(
  name: string,
  itemTitle: string,
  minLen = 25,
): number {
  const { title: part } = filenameParts(name);
  const folded = normText(part);
  const other = normText(itemTitle);
  if (!folded || !other) return 0;
  let best = ratio(folded, other);
  if (folded.length >= minLen && other.length > folded.length) {
    best = Math.max(best, ratio(folded, other.slice(0, folded.length)));
  }
  return best;
}
