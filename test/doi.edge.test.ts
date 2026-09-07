import { assert } from "chai";
import {
  cleanDoi,
  doiVariants,
  citedInBrackets,
  firstDoiIn,
  isJournalLevelDoi,
  isSupplementDoi,
  normaliseDoi,
  supplementParentDoi,
  DOI_RE,
} from "../src/modules/pdfText";

/**
 * Adversarial cases for the DOI rules, written alongside doi.test.ts.
 *
 * doi.test.ts records the cases that came out of a real library and that the
 * rules were written to fix. This file goes the other way: it probes the
 * rules with the shapes they were *not* written for, so that the boundary of
 * each one is recorded rather than assumed. Where a case is a limitation
 * rather than a defect, the assertion pins the current behaviour and the
 * comment says why that is acceptable -- so a later change to the rule shows
 * up here as a decision to re-take, not as a silent drift.
 */
describe("DOI rules under adversarial input", function () {
  describe("cleanDoi line-noise stripping", function () {
    /**
     * The stripper removes a trailing "pdf" because extraction runs the
     * download banner into the DOI. A DOI whose own suffix ends in those
     * three letters is indistinguishable from that noise and is cut too.
     * Crossref then answers 404 and the file is reported as unverifiable,
     * which is the safe direction to fail in -- but it is a real loss.
     */
    it("cannot tell a real suffix ending in pdf from the download banner", function () {
      assert.equal(
        cleanDoi("10.1093/jopart/muv030pdf"),
        "10.1093/jopart/muv030",
      );
    });

    /**
     * "http" onwards is dropped greedily. That is right when the extractor
     * has concatenated a URL onto the DOI, and wrong for a suffix that
     * happens to contain the four letters.
     */
    it("drops everything from http onwards, including inside a suffix", function () {
      assert.equal(
        cleanDoi("10.1234/abc123httpwww.example.com"),
        "10.1234/abc123",
      );
      assert.equal(cleanDoi("10.1234/httpxyz"), "10.1234/");
    });

    /**
     * The previous case can leave a bare prefix. Eight characters clears the
     * length gate in firstDoiIn, so a stub like this is accepted as a DOI and
     * spends a Crossref lookup before failing. Worth a length check that
     * requires something after the slash.
     */
    it("can return a prefix with an empty suffix that still clears the length gate", function () {
      const stub = cleanDoi("10.1234/pdf");
      assert.equal(stub, "10.1234/");
      assert.isAbove(
        stub.length,
        7,
        "firstDoiIn admits anything longer than 7",
      );
    });

    it("only strips the banner words it knows, not every trailing word", function () {
      // "Downloaded from" is stripped; "Downloaded" alone is not.
      assert.equal(
        cleanDoi("10.1037/abc123Downloaded"),
        "10.1037/abc123Downloaded",
      );
    });

    it("leaves a bracketed DOI intact rather than trimming into it", function () {
      assert.equal(
        cleanDoi("10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2"),
        "10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2",
      );
    });
  });

  describe("isJournalLevelDoi coverage", function () {
    it("catches the Wiley form in either case", function () {
      assert.isTrue(isJournalLevelDoi("10.1111/(ISSN)2044-8295"));
      assert.isTrue(isJournalLevelDoi("10.1111/(issn)2044-8295"));
      assert.isTrue(
        isJournalLevelDoi(
          normaliseDoi("https://doi.org/10.1111/(ISSN)2044-8295"),
        ),
      );
    });

    /**
     * A journal-level DOI from a publisher that does not use the (ISSN)
     * marker is recognised by its shape instead: it names a journal and
     * nothing else, so its suffix carries no digit.
     */
    it("catches a journal-level DOI without the ISSN marker", function () {
      assert.isTrue(isJournalLevelDoi("10.3389/fpsyg"));
      assert.isTrue(isJournalLevelDoi("10.1111/bjop"));
      assert.isTrue(isJournalLevelDoi("10.1176/appi.ajp"));
    });

    it("catches Elsevier's issue-level placeholder", function () {
      assert.isTrue(isJournalLevelDoi("10.1016/S0022-3999(00)X0000-0"));
    });

    /**
     * The half of this rule that matters: an article DOI must not be
     * mistaken for a journal one, or the file it belongs to loses the DOI it
     * printed and falls back to a filename search.
     */
    it("leaves real article DOIs alone", function () {
      for (const doi of [
        "10.1016/j.foo.2019.01.001",
        "10.3389/fpsyg.2018.00282",
        "10.1037/bul0000452",
        "10.1093/scan/nsw154",
        "10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2",
        "10.1016/S0022-3999(00)00120-6",
        "10.1111/j.1467-8624.2010.01564.x",
      ]) {
        assert.isFalse(isJournalLevelDoi(doi), doi);
      }
    });
  });

  describe("firstDoiIn on a hyphenated line break", function () {
    /**
     * Annual Reviews hyphenates the DOI to fit the column, so the match
     * stops at the break. Splicing the next line's leading run back on
     * recovers the DOI that was printed.
     */
    it("splices the continuation from the next line", function () {
      const page =
        "Downloaded from www.annualreviews.org\n" +
        "https://doi.org/10.1146/annurev-clinpsy-081219-\n" +
        "115627\n" +
        "Annu. Rev. Clin. Psychol. 2020.16:213-238.";
      assert.equal(firstDoiIn(page), "10.1146/annurev-clinpsy-081219-115627");
    });

    /**
     * The load-bearing half. With nothing to splice, trimming the hyphen
     * away leaves a shorter string that still looks like a well-formed DOI,
     * and the only evidence that it was cut is gone -- so a confident,
     * wrong DOI would be recorded. Better to have no DOI and let the
     * filename search identify the file.
     */
    it("returns nothing rather than a truncated DOI", function () {
      assert.isNull(
        firstDoiIn("https://doi.org/10.1146/annurev-clinpsy-081219-"),
      );
      assert.isNull(
        firstDoiIn("10.1146/annurev-clinpsy-081219-\n\nUnrelated heading"),
      );
    });

    it("still reads an ordinary DOI, and skips a journal-level one", function () {
      assert.equal(firstDoiIn("doi:10.1037/abc123 and more"), "10.1037/abc123");
      assert.equal(
        firstDoiIn("10.1111/(ISSN)2044-8295 see 10.1111/bjop.12345"),
        "10.1111/bjop.12345",
      );
    });
  });

  describe("isSupplementDoi coverage", function () {
    it("is case-insensitive on the suffix it knows", function () {
      assert.isTrue(isSupplementDoi("10.1037/bul0000452.SUPP"));
    });

    /**
     * Only an exact trailing ".supp" is recognised, which is the APA shape.
     * A numbered or otherwise decorated supplement DOI is not, so its PDF is
     * treated as the article. The article-type test does not help here: the
     * supplement's Crossref record is often typed as a journal article too.
     */
    it("does not recognise numbered or decorated supplement suffixes", function () {
      assert.isFalse(isSupplementDoi("10.1037/bul0000452.supp1"));
      assert.isFalse(isSupplementDoi("10.1037/bul0000452.supp.pdf"));
      assert.isFalse(isSupplementDoi("10.1037/bul0000452-supp"));
    });

    it("names the article a supplement belongs to", function () {
      assert.equal(
        supplementParentDoi("https://doi.org/10.1037/bul0000452.SUPP"),
        "10.1037/bul0000452",
      );
    });

    it("names nothing for a DOI that is not a supplement", function () {
      assert.equal(supplementParentDoi("10.1037/bul0000452"), "");
      assert.equal(supplementParentDoi(""), "");
    });
  });

  describe("doiVariants", function () {
    it("offers the whole bracketed DOI before the cut form, and nothing else", function () {
      assert.deepEqual(
        doiVariants("10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2"),
        [
          "10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2",
          "10.1890/1540-9295(2003)001",
        ],
      );
    });

    it("offers the paren-stripped form for a DOI ending in a citation year", function () {
      assert.deepEqual(doiVariants("10.1234/abc(2003)"), [
        "10.1234/abc(2003)",
        "10.1234/abc(2003",
      ]);
    });

    it("returns nothing for a string too short to be a DOI", function () {
      assert.deepEqual(doiVariants("10.1/a"), []);
    });
  });

  describe("DOI_RE", function () {
    it("stops before an adjacent bracketed citation number", function () {
      assert.deepEqual("10.1016/j.foo.2019.01.001 [23] next".match(DOI_RE), [
        "10.1016/j.foo.2019.01.001",
      ]);
    });

    it("finds every DOI in a line of text, in order", function () {
      assert.deepEqual(
        "see 10.1037/abc123 and also 10.1093/scan/nsw154".match(DOI_RE),
        ["10.1037/abc123", "10.1093/scan/nsw154"],
      );
    });

    /**
     * The pattern is exported with the global flag, so it carries lastIndex
     * between calls. String.match resets it, which is why the module's own
     * use is safe -- but test() and exec() do not, and an exported stateful
     * regex is a trap for any later caller.
     */
    it("carries lastIndex after test(), which a later caller must not trust", function () {
      const text = "see 10.1037/abc123 and also 10.1093/scan/nsw154";
      DOI_RE.lastIndex = 0;
      assert.isTrue(DOI_RE.test(text));
      assert.notEqual(DOI_RE.lastIndex, 0, "state survives the call");
      DOI_RE.lastIndex = 0;
    });
  });

  describe("normaliseDoi", function () {
    it("strips every stored prefix shape and folds case", function () {
      assert.equal(
        normaliseDoi("HTTPS://DOI.ORG/10.1037/ABC123"),
        "10.1037/abc123",
      );
      assert.equal(normaliseDoi("doi: 10.1037/abc123"), "10.1037/abc123");
      assert.equal(
        normaliseDoi("http://dx.doi.org/10.1037/abc123"),
        "10.1037/abc123",
      );
    });

    it("is safe on the shapes a dirty field actually holds", function () {
      assert.equal(normaliseDoi(null), "");
      assert.equal(normaliseDoi(undefined), "");
      assert.equal(normaliseDoi("   "), "");
    });
  });

  describe("firstDoiIn on a page that cites another paper's DOI", function () {
    /**
     * Real: Moncoucy 2025, "The Value of Consciousness". Page one prints the
     * paper's own DOI as a bare link and cites Cleeremans and Tallon-Baudry
     * inside the abstract. Zotero's extractor emitted the abstract first, so
     * the file was recorded under the DOI of the paper it cites.
     */
    const ownFirst =
      "consciousness: experiences worth having. Phil.\n" +
      "Trans. R. Soc. B 380: 20240303.\n" +
      "https://doi.org/10.1098/rstb.2024.0303\n" +
      "Received: 14 December 2024\n" +
      "...elaborate on the perspective developed by Axel Cleeremans and\n" +
      "Catherine Tallon-Baudry (Cleeremans, Tallon-Baudry 2022 Neurosci.\n" +
      "Conscious, 2022, niac007. (doi:10.1093/nc/niac007)) and defend...\n";

    const citedFirst =
      "...elaborate on the perspective developed by Axel Cleeremans and\n" +
      "Catherine Tallon-Baudry (Cleeremans, Tallon-Baudry 2022 Neurosci.\n" +
      "Conscious, 2022, niac007. (doi:10.1093/nc/niac007)) and defend...\n" +
      "consciousness: experiences worth having. Phil.\n" +
      "Trans. R. Soc. B 380: 20240303.\n" +
      "https://doi.org/10.1098/rstb.2024.0303\n";

    it("takes the paper's own DOI, not the one it cites", function () {
      assert.equal(firstDoiIn(ownFirst), "10.1098/rstb.2024.0303");
    });

    it("takes it whichever order the extractor emits them in", function () {
      // The whole point: the previous rule returned the first match, so this
      // ordering -- the one Zotero actually produced -- gave the wrong paper.
      assert.equal(firstDoiIn(citedFirst), "10.1098/rstb.2024.0303");
    });

    it("still reads a DOI whose only appearance is a citation", function () {
      const onlyCited =
        "as reported elsewhere (Smith 2019, doi:10.1037/abc0000123).\n";
      assert.equal(firstDoiIn(onlyCited), "10.1037/abc0000123");
    });

    it("does not mistake a DOI's own brackets for a citation", function () {
      const bracketed =
        "https://doi.org/10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2\n";
      assert.equal(
        firstDoiIn(bracketed),
        "10.1890/1540-9295(2003)001[0376:ASSIE]2.0.CO;2",
      );
    });

    it("reads a reference-list line, where the brackets have closed", function () {
      // "(2020)" opens and closes before the DOI, so the line does not read as
      // a citation wrapped around it.
      const ref =
        "Smith, J. (2020). A title. Journal 5:1-10. " +
        "https://doi.org/10.1037/xyz0000999\n";
      assert.equal(firstDoiIn(ref), "10.1037/xyz0000999");
    });
  });

  describe("citedInBrackets", function () {
    it("is true only inside a bracket left open on the same line", function () {
      const line = "text (see doi:10.1000/aaa111) and doi:10.1000/bbb222\n";
      assert.isTrue(citedInBrackets(line, line.indexOf("10.1000/aaa111")));
      assert.isFalse(citedInBrackets(line, line.indexOf("10.1000/bbb222")));
    });

    it("does not carry a bracket across a line break", function () {
      // A citation opened on the line above has no bearing on a DOI printed
      // alone on its own line, which is how a paper prints its own.
      const text = "opened here (Author 2020\n10.1000/ccc333\n";
      assert.isFalse(citedInBrackets(text, text.indexOf("10.1000/ccc333")));
    });
  });
});
