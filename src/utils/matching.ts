import { ratio, normText } from "./similarity";
import { surnameOf } from "./naming";

const FILENAME_SHAPE = /^(?<auth>.+?) - (?<yr>(?:19|20)\d\d) - (?<title>.+)$/;

/**
 * Ceiling on a score earned by cutting the item title down to the length the
 * filename had room for. It has to stay above the reconcile floor of 0.86 --
 * the cut exists to rescue a truncated filename -- while leaving 1.0 to titles
 * that agree outright.
 */
const PREFIX_CEILING = 0.995;

/** Ceiling for a pair the tail words say are two different works. */
const DIFFERENT_WORK = 0.5;

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
 * Tokens that mark a separate work when a continuation opens with one. A title
 * that carries on past the other with "part two" or "corrigendum" is not the
 * same paper with a longer title; it is a different paper.
 */
const CONTINUATION =
  /^(?:part|pt|volume|vol|chapter|ch|section|book|erratum|errata|corrigendum|correction|corrected|retraction|retracted|reply|response|comment|commentary|rejoinder|addendum|supplement|supplementary|appendix)$/;

/** Tokens that number a work: "Part I" against "Part II", "Part 1" / "Part 2". */
const ENUMERATOR =
  /^(?:\d{1,3}|i{1,3}|iv|vi{0,3}|ix|xi{0,3}|first|second|third|fourth|one|two|three|four)$/;

/**
 * Whether two folded titles that share an opening are nonetheless different
 * works, judged from the words where they part company.
 */
export function differentWork(a: string, b: string): boolean {
  const ta = a.split(" ");
  const tb = b.split(" ");
  let i = 0;
  while (i < ta.length && i < tb.length && ta[i] === tb[i]) i += 1;
  const restA = ta.slice(i);
  const restB = tb.slice(i);
  if (!restA.length && !restB.length) return false;
  // One title stops where the other carries on. A continuation that opens
  // with "corrigendum" or "part" is a different paper; one that opens with an
  // ordinary word is the ending a truncated filename had to drop.
  if (!restA.length || !restB.length) {
    return CONTINUATION.test((restA.length ? restA : restB)[0]);
  }
  // Both carry on, and each carries on by exactly one number: Part I / Part II.
  return (
    restA.length === 1 &&
    restB.length === 1 &&
    ENUMERATOR.test(restA[0]) &&
    ENUMERATOR.test(restB[0])
  );
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
 * -- scores 0.805 whole against whole, and 0.995 once the prefix is dropped
 * and the title is cut to the length the filename actually had room for.
 *
 * Two guards keep the cut from turning "begins with" into "is":
 *
 *   - it is only offered to a filename long enough to have been truncated at
 *     all. Zotero cuts the title portion at 100 characters, at a word boundary,
 *     so a genuinely truncated title folds to roughly 90; `minLen` sits at 80
 *     to leave room for punctuation the folding removes. Below that the title
 *     is whole, and a whole title that merely opens like another is a different
 *     paper -- Part I is not Part II, and a review is not its own corrigendum.
 *   - a cut score is capped just under 1.0, so an item whose title matches
 *     outright always outranks one that only matches as far as the cut.
 */
export function titleScore(
  name: string,
  itemTitle: string,
  minLen = 80,
): number {
  const { title: part } = filenameParts(name);
  return foldedTitleScore(normText(part), normText(itemTitle), minLen);
}

/**
 * The same score, taking strings that are already folded.
 *
 * Scoring one filename against a whole library re-folded every item title
 * once per file. A caller that folds the library once and calls this keeps the
 * scoring identical and does that work once.
 */
export function foldedTitleScore(
  folded: string,
  other: string,
  minLen = 80,
): number {
  if (!folded || !other) return 0;
  const best = ratio(folded, other);
  if (differentWork(folded, other)) return Math.min(best, DIFFERENT_WORK);
  if (folded.length >= minLen && other.length > folded.length) {
    const cut = ratio(folded, other.slice(0, folded.length));
    return Math.max(best, Math.min(cut, PREFIX_CEILING));
  }
  return best;
}

/**
 * The highest score two titles of these lengths could possibly reach.
 *
 * `ratio` counts matching characters against the combined length, so two
 * strings of very different lengths cannot score highly however well they
 * agree: the bound is 2·shorter/(shorter+longer). A caller with a floor can
 * skip the comparison outright for an item that cannot clear it, which is
 * most of a library. Exact rather than heuristic -- it is an upper bound, so
 * nothing that would have matched is skipped -- and the cut branch is allowed
 * its ceiling, since that compares equal lengths.
 */
export function titleScoreCeiling(
  foldedLen: number,
  otherLen: number,
  minLen = 80,
): number {
  if (!foldedLen || !otherLen) return 0;
  if (foldedLen >= minLen && otherLen > foldedLen) return PREFIX_CEILING;
  const lo = Math.min(foldedLen, otherLen);
  const hi = Math.max(foldedLen, otherLen);
  return (2 * lo) / (lo + hi);
}

/**
 * Whether anything other than the title agrees. The title alone is not enough:
 * two papers can share an opening, and a truncated filename is a prefix of
 * every title that starts the same way, so a top score with nothing behind it
 * files a file under the wrong item and then reports the right item missing.
 */
export function corroborates(
  parts: { first: string; year: string; title: string },
  item: { title: string; year: string; creators: string[] },
): boolean {
  // An outright title match needs nothing behind it.
  if (normText(parts.title) && normText(parts.title) === normText(item.title)) {
    return true;
  }
  if (parts.year && /^\d{4}$/.test(item.year)) {
    // A reprint or an online-first year is off by one and still the same paper.
    if (Math.abs(Number(parts.year) - Number(item.year)) <= 1) return true;
  }
  const surname = normText(surnameOf(parts.first));
  if (surname) {
    return item.creators.some((c) => normText(surnameOf(c)) === surname);
  }
  return false;
}
