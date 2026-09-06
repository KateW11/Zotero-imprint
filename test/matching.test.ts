import { assert } from "chai";
import { filenameParts, titleScore } from "../src/utils/matching";
import { normText, ratio } from "../src/utils/similarity";

describe("ratio", function () {
  /**
   * A port of Python's difflib.SequenceMatcher.ratio. The matching thresholds
   * were tuned against that function's numbers on a real library, so if this
   * drifts the thresholds quietly come to mean something else.
   */
  it("is 1 for identical strings and 0 for nothing in common", function () {
    assert.equal(ratio("abcd", "abcd"), 1);
    assert.equal(ratio("abc", "xyz"), 0);
  });

  it("matches difflib's published example", function () {
    // difflib's own docstring: SequenceMatcher(None, "abcd", "bcde").ratio()
    assert.closeTo(ratio("abcd", "bcde"), 0.75, 0.0001);
  });

  it("treats two empty strings as identical", function () {
    assert.equal(ratio("", ""), 1);
  });
});

describe("normText", function () {
  it("folds case and punctuation to comparable words", function () {
    assert.equal(normText("Allostasis: A Model!"), "allostasis a model");
  });
});

describe("filenameParts", function () {
  it("splits the convention Zotero writes", function () {
    const p = filenameParts("Barrett - 2017 - Theory of Constructed Emotion.pdf");
    assert.equal(p.first, "Barrett");
    assert.equal(p.year, "2017");
    assert.equal(p.title, "Theory of Constructed Emotion");
  });

  it("takes only the first author from an et al. or two-author name", function () {
    assert.equal(filenameParts("Scheffer et al. - 2009 - Early-warning.pdf").first, "Scheffer");
    assert.equal(filenameParts("Arksey and O'Malley - 2005 - Scoping.pdf").first, "Arksey");
  });

  it("ignores a duplicate suffix", function () {
    const p = filenameParts("Molenaar - 2004 - A Manifesto (duplicate).pdf");
    assert.equal(p.title, "A Manifesto");
  });

  it("gives back the stem when the name follows no convention", function () {
    const p = filenameParts("fpsyg-09-00282.pdf");
    assert.equal(p.first, "");
    assert.equal(p.year, "");
    assert.equal(p.title, "fpsyg-09-00282");
  });
});

describe("titleScore", function () {
  /**
   * The case this exists for. Zotero writes "Author - Year - Title" and
   * truncates the title at 100 characters, so comparing whole against whole
   * scores a perfect match well below any sensible threshold.
   */
  const file =
    "Molenaar - 2004 - A Manifesto on Psychology as Idiographic Science: " +
    "Bringing the Person Back Into Scientific.pdf";
  const item =
    "A Manifesto on Psychology as Idiographic Science: Bringing the Person " +
    "Back Into Scientific Psychology, This Time Forever";

  it("scores a truncated filename against the full title as a match", function () {
    assert.isAbove(titleScore(file, item), 0.99);
  });

  it("stays under the reconcile floor for a different paper", function () {
    assert.isBelow(titleScore(file, "Alternative stable states in ecology"), 0.86);
  });

  it("will not let a short filename match anything that starts the same", function () {
    // Too short to be distinctive, so the truncation allowance is not applied
    assert.isBelow(titleScore("Smith - 2020 - The.pdf", "The Theory of Everything"), 0.86);
  });

  it("is zero when either side is empty", function () {
    assert.equal(titleScore("Barrett - 2017 - Theory.pdf", ""), 0);
  });
});
