import { assert } from "chai";
import {
  cleanDoi,
  doiVariants,
  isJournalLevelDoi,
  isSupplementDoi,
  normaliseDoi,
} from "../src/modules/pdfText";

/**
 * Every case here came out of a real library. The two rejection rules in
 * particular are the ones that were silently reporting the wrong answer before
 * anyone looked, so they are the ones most worth pinning down.
 */

describe("cleanDoi", function () {
  it("strips the punctuation text extraction drags in", function () {
    assert.equal(cleanDoi("10.1038/nature08227."), "10.1038/nature08227");
    assert.equal(cleanDoi("10.1038/nature08227)"), "10.1038/nature08227");
    assert.equal(cleanDoi("10.1038/nature08227];"), "10.1038/nature08227");
  });

  it("strips a trailing semicolon without eating a DOI that ends in one", function () {
    // Real: the Huang preprint came out of extraction with a trailing ";"
    assert.equal(
      cleanDoi("10.64898/2026.04.27.26351804;"),
      "10.64898/2026.04.27.26351804",
    );
  });

  it("strips line noise the extractor runs into the DOI", function () {
    assert.equal(cleanDoi("10.1038/nature08227pdf"), "10.1038/nature08227");
    assert.equal(
      cleanDoi("10.1038/nature08227Downloadedfrom"),
      "10.1038/nature08227",
    );
  });
});

describe("isJournalLevelDoi", function () {
  /**
   * Wiley and others stamp the journal's DOI in the PDF metadata. Accepting
   * one files the wrong work while looking entirely confident.
   */
  it("rejects the journal-level DOIs found in real files", function () {
    // British Journal of Psychology, not the Hardy and Parfitt paper
    assert.isTrue(isJournalLevelDoi("10.1111/(ISSN)2044-8295"));
    assert.isTrue(isJournalLevelDoi("10.1002/(ISSN)1540-9309"));
    assert.isTrue(isJournalLevelDoi("10.1111/(ISSN)1399-6576"));
  });

  it("does not reject the article DOIs from the same journals", function () {
    assert.isFalse(isJournalLevelDoi("10.1111/j.2044-8295.1991.tb02391.x"));
    assert.isFalse(isJournalLevelDoi("10.1111/aas.70281"));
  });

  it("does not reject a DOI that merely contains brackets", function () {
    assert.isFalse(
      isJournalLevelDoi("10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2"),
    );
  });
});

describe("isSupplementDoi", function () {
  it("recognises a supplement's own DOI", function () {
    // Both real: the file is the paper's appendix, not a different paper
    assert.isTrue(isSupplementDoi("10.1037/bul0000452.supp"));
    assert.isTrue(isSupplementDoi("10.1037/pas0000620.supp"));
  });

  it("leaves ordinary DOIs alone", function () {
    assert.isFalse(isSupplementDoi("10.1037/bul0000452"));
    assert.isFalse(isSupplementDoi("10.1093/scan/nsw154"));
  });
});

describe("doiVariants", function () {
  it("tries the bracketed DOI whole before cutting it", function () {
    // Older ESA and AGU DOIs contain brackets; a pattern that stops at "["
    // truncates them, one that allows them can swallow a citation after it.
    const variants = doiVariants("10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2");
    assert.equal(variants[0], "10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2");
    assert.include(variants, "10.1890/1540-9295(2003)001");
  });

  it("does not repeat a variant that collapses to the same string", function () {
    const variants = doiVariants("10.1093/scan/nsw154");
    assert.equal(variants.length, 1);
  });

  it("discards anything too short to be a DOI", function () {
    assert.deepEqual(doiVariants("10.1/x"), []);
  });
});

describe("normaliseDoi", function () {
  it("reduces every stored shape to the bare DOI", function () {
    const bare = "10.1093/scan/nsw154";
    assert.equal(normaliseDoi("https://doi.org/10.1093/scan/nsw154"), bare);
    assert.equal(normaliseDoi("https://dx.doi.org/10.1093/scan/nsw154"), bare);
    assert.equal(normaliseDoi("doi: 10.1093/scan/nsw154"), bare);
    assert.equal(normaliseDoi("  10.1093/SCAN/NSW154  "), bare);
  });

  it("is safe on nothing", function () {
    assert.equal(normaliseDoi(null), "");
    assert.equal(normaliseDoi(undefined), "");
  });
});
