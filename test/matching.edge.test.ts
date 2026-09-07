import { assert } from "chai";
import { corroborates, filenameParts, titleScore } from "../src/utils/matching";
import { normText, ratio } from "../src/utils/similarity";

/**
 * Adversarial cases for filename-to-item matching.
 *
 * The thresholds that consume titleScore are 0.86 in reconcile.ts and 0.72 in
 * folderIntake.ts, so what matters is not the score in the abstract but which
 * side of those numbers a given pair lands on. These cases are built around
 * the two floors.
 *
 * One test in here is expected to FAIL against the current implementation and
 * is marked KNOWN DEFECT.
 */
const RECONCILE_FLOOR = 0.86;
const INTAKE_FLOOR = 0.72;

describe("matching under adversarial input", function () {
  describe("filenameParts", function () {
    it("takes the first year, not a year inside the title", function () {
      assert.deepEqual(
        filenameParts("Smith - 2020 - Trends 1999 - 2001 - revisited.pdf"),
        {
          first: "Smith",
          year: "2020",
          title: "Trends 1999 - 2001 - revisited",
        },
      );
    });

    it("splits a two-author name on 'and'", function () {
      assert.equal(
        filenameParts("Smith and Jones - 2020 - Title.pdf").first,
        "Smith",
      );
    });

    it("splits an et al. name with no trailing space", function () {
      assert.equal(
        filenameParts("Scheffer et al. - 2009 - Title.pdf").first,
        "Scheffer",
      );
    });

    /**
     * A title beginning with a year is read as an author-year prefix. The
     * consequence is confined to the author-and-year rescue pass, which needs
     * a unique hit on "1968|1972" to fire, so it costs a missed rescue rather
     * than a wrong match.
     */
    it("reads a leading year as the author when the filename has no author", function () {
      assert.deepEqual(filenameParts("1968 - 1972 - Something.pdf"), {
        first: "1968",
        year: "1972",
        title: "Something",
      });
    });

    it("strips a numbered or 'duplicate' suffix but not other copy markers", function () {
      assert.equal(
        filenameParts("Smith - 2020 - Title (1).pdf").title,
        "Title",
      );
      assert.equal(
        filenameParts("Smith - 2020 - Title (duplicate).pdf").title,
        "Title",
      );
      // macOS writes "(copy)", which is not in the pattern.
      assert.equal(
        filenameParts("Smith - 2020 - Title (copy).pdf").title,
        "Title (copy)",
      );
    });

    it("strips one extension only", function () {
      assert.equal(
        filenameParts("Smith - 2020 - Title.pdf.pdf").title,
        "Title.pdf",
      );
    });

    it("hands back the whole stem when the name follows no convention", function () {
      assert.deepEqual(filenameParts("fpsyg-09-00282.pdf"), {
        first: "",
        year: "",
        title: "fpsyg-09-00282",
      });
    });
  });

  describe("titleScore prefix cut", function () {
    const truncated =
      "A Manifesto on Psychology as Idiographic Science: Bringing the Person Back Into Scientific";
    const whole =
      "A Manifesto on Psychology as Idiographic Science: Bringing the Person Back Into Scientific Psychology, This Time Forever";

    it("scores a Zotero-truncated filename against the full title as a match", function () {
      const s = titleScore(`Molenaar - 2004 - ${truncated}.pdf`, whole);
      assert.isAbove(s, RECONCILE_FLOOR);
      // Capped below 1.0 so an item whose title agrees outright always wins.
      assert.isBelow(s, 1);
    });

    it("lets an outright title match outrank a truncated one", function () {
      const exact = titleScore(`Molenaar - 2004 - ${truncated}.pdf`, truncated);
      const cut = titleScore(`Molenaar - 2004 - ${truncated}.pdf`, whole);
      assert.equal(exact, 1);
      assert.isAbove(exact, cut);
    });

    /**
     * The cut is one-directional: it shortens the *item* title to the length
     * of the filename, never the other way round. When the library holds the
     * truncated title and the folder holds the full one -- which happens when
     * the item was created from a filename -- the same pair scores 0.8599 and
     * falls under the reconcile floor of 0.86 by a thousandth. The pair is a
     * match in one direction and not in the other.
     */
    it("is not symmetric, and the reversed direction falls under the reconcile floor", function () {
      const reversed = titleScore(`Molenaar - 2004 - ${whole}.pdf`, truncated);
      assert.isBelow(reversed, RECONCILE_FLOOR);
      assert.isAbove(reversed, INTAKE_FLOOR);
    });

    /**
     * Was the sharpest defect in this file, now fixed two ways: the cut is
     * only offered to a filename long enough to have been truncated, and a
     * pair that parts company at a number or an errata word is read as two
     * different works. Part I no longer matches Part II, and a paper no
     * longer matches the review that extends it.
     */
    it("does not score a different paper with the same opening as a perfect match", function () {
      const partOne = titleScore(
        "Smith - 2020 - Neural correlates of memory Part I.pdf",
        "Neural correlates of memory Part II",
      );
      assert.isBelow(partOne, RECONCILE_FLOOR, "Part I must not match Part II");

      const extended = titleScore(
        "Smith - 2020 - The role of sleep in memory consolidation.pdf",
        "The role of sleep in memory consolidation: a critical review",
      );
      assert.isBelow(extended, 1, "a strict extension must not score 1.0");
    });

    it("will not let a filename shorter than the guard match on its opening", function () {
      // Far under the 80-character guard, so the title cannot have been
      // truncated, the cut is not offered, and the whole strings are compared.
      const s = titleScore(
        "Smith - 2020 - Attention.pdf",
        "Attention and the brain in health and disease",
      );
      assert.isBelow(s, INTAKE_FLOOR);
    });

    it("is unaffected by case and punctuation", function () {
      assert.equal(
        titleScore(
          "Smith - 2020 - THE BRAIN, REVISITED.pdf",
          "the brain revisited",
        ),
        1,
      );
    });

    it("scores a publisher-default filename against a real title far below both floors", function () {
      const s = titleScore("fpsyg-09-00282.pdf", "Attention and the brain");
      assert.isBelow(s, INTAKE_FLOOR);
    });

    it("is zero when either side is empty", function () {
      assert.equal(titleScore("", "Some title"), 0);
      assert.equal(titleScore("Smith - 2020 - Title.pdf", ""), 0);
    });
  });

  describe("ratio and normText", function () {
    it("matches difflib's published example", function () {
      assert.closeTo(ratio("abcd", "bcde"), 0.75, 1e-12);
    });

    it("treats two empty strings as identical and one empty as nothing in common", function () {
      assert.equal(ratio("", ""), 1);
      assert.equal(ratio("abc", ""), 0);
    });

    it("folds punctuation and case but keeps word order significant", function () {
      assert.equal(
        normText("The Brain: A Review!"),
        normText("the brain a review"),
      );
      assert.isBelow(
        ratio(
          normText("a review of the brain"),
          normText("the brain a review"),
        ),
        1,
      );
    });
  });

  /**
   * The second half of the prefix fix: reconcile no longer accepts a top title
   * score on its own. These are the cases that decide whether a high score is
   * allowed to stand.
   */
  describe("corroborates", function () {
    const name = "Smith - 2020 - Neural correlates of memory.pdf";
    // What filenameParts() returns for that name, asserted below rather than
    // computed here, so the two stay tied together.
    const parts = {
      first: "Smith",
      year: "2020",
      title: "Neural correlates of memory",
    };

    it("is fed exactly what the filename parser produces", function () {
      assert.deepEqual(filenameParts(name), parts);
    });

    it("accepts an outright title match with nothing else to go on", function () {
      assert.isTrue(
        corroborates(
          { first: "", year: "", title: "Neural correlates of memory" },
          { title: "Neural correlates of memory!", year: "", creators: [] },
        ),
      );
    });

    it("accepts a year that agrees, and tolerates a year off by one", function () {
      const item = { title: "Something else entirely", creators: [] };
      assert.isTrue(corroborates(parts, { ...item, year: "2020" }));
      assert.isTrue(corroborates(parts, { ...item, year: "2021" }));
    });

    it("refuses a year that disagrees when no author matches", function () {
      assert.isFalse(
        corroborates(parts, {
          title: "Neural correlates of memory Part II",
          year: "2014",
          creators: ["Okasha"],
        }),
      );
    });

    it("accepts an author match when the year is missing from the item", function () {
      assert.isTrue(
        corroborates(parts, {
          title: "Neural correlates of memory Part II",
          year: "",
          creators: ["Jane Smith"],
        }),
      );
    });

    it("refuses a filename with no author and no year behind a partial title", function () {
      assert.isFalse(
        corroborates(
          { first: "", year: "", title: "Neural correlates" },
          {
            title: "Neural correlates of memory",
            year: "2020",
            creators: ["Jane Smith"],
          },
        ),
      );
    });
  });
});
