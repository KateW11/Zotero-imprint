import { assert } from "chai";
import {
  foldedTitleScore,
  titleScore,
  titleScoreCeiling,
} from "../src/utils/matching";
import { normText } from "../src/utils/similarity";

/**
 * The length ceiling that lets the match loop skip an item without scoring
 * it.
 *
 * The claim being tested is that it is an upper bound, not a heuristic: if
 * the ceiling says an item cannot reach the floor, then scoring it would not
 * have reached the floor either. If that ever stops holding, the scan starts
 * silently missing matches, which is the failure mode the whole plugin is
 * meant not to have -- so it is asserted over a spread of real title shapes
 * rather than a couple of examples.
 */
describe("titleScoreCeiling", function () {
  const titles = [
    "Mindfulness and emotion regulation in daily life",
    "Mindfulness and emotion regulation in daily life: a diary study",
    "Emotion",
    "Attention",
    "The dynamics of resilience: a network approach to depression and anxiety",
    "The dynamics of resilience",
    "A critical reappraisal of the emotion regulation literature since 1998",
    "Cognitive reappraisal and expressive suppression: divergent consequences",
    "Cognitive reappraisal and expressive suppression",
    "",
  ];

  it("is never below the score it bounds", function () {
    for (const a of titles) {
      const folded = normText(a);
      for (const b of titles) {
        const other = normText(b);
        const bound = titleScoreCeiling(folded.length, other.length);
        const actual = foldedTitleScore(folded, other);
        assert.isAtLeast(
          bound + 1e-12,
          actual,
          `bound ${bound} < score ${actual} for "${a}" vs "${b}"`,
        );
      }
    }
  });

  it("skips exactly the pairs that could not have cleared the floor", function () {
    const floor = 0.86;
    let skipped = 0;
    for (const a of titles) {
      const folded = normText(a);
      for (const b of titles) {
        const other = normText(b);
        if (titleScoreCeiling(folded.length, other.length) < floor) {
          skipped += 1;
          assert.isBelow(
            foldedTitleScore(folded, other),
            floor,
            `skipped a pair that scores over the floor: "${a}" vs "${b}"`,
          );
        }
      }
    }
    // If nothing is skipped the prefilter is not doing anything and this test
    // is not testing anything.
    assert.isAbove(skipped, 0, "the prefilter skipped nothing");
  });

  /**
   * A filename long enough to have been truncated by Zotero's naming
   * template is exactly the case the length bound would otherwise throw
   * away, because the item's full title is much longer than what fits in the
   * filename. Past the cut length the ceiling has to defer to the prefix
   * branch instead.
   */
  it("does not skip a title that a cut filename could still match", function () {
    const full =
      "Mindfulness and emotion regulation in daily life: a diary study of " +
      "undergraduate students across one semester";
    const folded = normText(full);
    const cut = folded.slice(0, 85);
    assert.isAtLeast(cut.length, 80, "the cut has to be past minLen");
    assert.isAtLeast(titleScoreCeiling(cut.length, folded.length), 0.86);
    // Under the cut length there is no such allowance, and the bound is the
    // length ratio: a 79-character filename cannot reach the floor against a
    // 108-character title, and scoring it confirms that.
    const shorter = folded.slice(0, 79);
    assert.isBelow(titleScoreCeiling(shorter.length, folded.length), 0.86);
    assert.isBelow(foldedTitleScore(shorter, folded), 0.86);
  });

  it("is zero when either side is empty", function () {
    assert.equal(titleScoreCeiling(0, 40), 0);
    assert.equal(titleScoreCeiling(40, 0), 0);
  });
});

describe("foldedTitleScore", function () {
  it("agrees with titleScore on a canonical filename", function () {
    const title = "Mindfulness and emotion regulation in daily life";
    const name = `Brockman et al. - 2021 - ${title}.pdf`;
    assert.equal(
      foldedTitleScore(normText(title), normText(title)),
      titleScore(name, title),
    );
  });
});
