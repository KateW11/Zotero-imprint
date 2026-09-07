/**
 * Python's difflib.SequenceMatcher.ratio(), ported.
 *
 * The matching thresholds in this plugin (0.86 for reconcile, 0.72 for library
 * matching) were tuned against the Python tool's numbers on a real library, so
 * the scoring has to agree with it or the thresholds mean something else.
 *
 * difflib's "autojunk" heuristic is not reproduced: it only engages on
 * sequences of 200 characters or more, and the strings compared here are
 * titles and filenames, which are shorter. A title long enough to trip it
 * would score very slightly differently from the Python tool.
 */

interface Block {
  a: number;
  b: number;
  size: number;
}

/** Longest matching block in a[alo:ahi] against b[blo:bhi]. */
function longestMatch(
  a: string,
  b: string,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
  b2j: Map<string, number[]>,
): Block {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;

  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    for (const j of b2j.get(a[i]) || []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) || 0) + 1;
      newj2len.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = newj2len;
  }
  return { a: besti, b: bestj, size: bestsize };
}

function matchingBlocks(a: string, b: string): Block[] {
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const list = b2j.get(b[j]);
    if (list) list.push(j);
    else b2j.set(b[j], [j]);
  }

  const queue: Array<[number, number, number, number]> = [
    [0, a.length, 0, b.length],
  ];
  const blocks: Block[] = [];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const m = longestMatch(a, b, alo, ahi, blo, bhi, b2j);
    if (!m.size) continue;
    blocks.push(m);
    if (alo < m.a && blo < m.b) queue.push([alo, m.a, blo, m.b]);
    if (m.a + m.size < ahi && m.b + m.size < bhi) {
      queue.push([m.a + m.size, ahi, m.b + m.size, bhi]);
    }
  }
  return blocks;
}

/** 2 * matched / total, between 0 and 1. */
export function ratio(a: string, b: string): number {
  const total = a.length + b.length;
  if (!total) return 1;
  let matches = 0;
  for (const block of matchingBlocks(a, b)) matches += block.size;
  return (2 * matches) / total;
}

/** Lowercase, strip everything but letters, digits and single spaces. */
export function normText(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
