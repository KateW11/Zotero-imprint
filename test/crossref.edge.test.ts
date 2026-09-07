import { assert } from "chai";
import { accept } from "../src/modules/crossref";
import { normText, ratio } from "../src/utils/similarity";

/**
 * The filename-search acceptance test.
 *
 * This is the route that has to identify a file whose printed DOI came out of
 * text extraction damaged, so a false negative here is a file the plugin
 * cannot place. The cases below pin what the test accepts and what it
 * refuses, and the first one records why it scores the parsed title rather
 * than the whole filename.
 */
describe("Crossref candidate acceptance", function () {
  const title =
    "Emotion regulation strategies in daily life: mindfulness, cognitive " +
    "reappraisal and emotion suppression";
  const article = (over: Record<string, unknown> = {}) => ({
    type: "journal-article",
    title: [title],
    issued: { "date-parts": [[2021]] },
    ...over,
  });

  it("accepts a canonical filename whose title matches the candidate", function () {
    const filename = `Brockman et al. - 2021 - ${title}.pdf`;
    const verdict = accept(article(), filename);
    assert.isTrue(verdict.ok, verdict.reason);
  });

  /**
   * Why it scores the parsed title. The author segment and the year are
   * noise in the ratio, and the shorter the title relative to them, the more
   * of the score they take: a paper with four named authors and a two-word
   * title scores 0.46 on the whole stem against its own exact title, under
   * the 0.55 floor, so the right candidate was refused. Recorded as a
   * measurement of the old rule, not an assertion about the current code.
   */
  it("refuses an exact title match when the whole stem is scored", function () {
    const short = "Emotion regulation";
    const stem = `Brockman, Kangas, Fitzpatrick and Sharp - 2021 - ${short}`;
    const wholeStem = ratio(normText(stem), normText(short));
    assert.isBelow(wholeStem, 0.55, `whole stem scored ${wholeStem}`);
    // The parsed title is the same string as the candidate title.
    assert.equal(ratio(normText(short), normText(short)), 1);
    // And the current rule accepts that pair.
    const verdict = accept(article({ title: [short] }), `${stem}.pdf`);
    assert.isTrue(verdict.ok, verdict.reason);
  });

  /**
   * A publisher default has no author-year-title shape to parse, so the
   * whole stem is the title and the behaviour is unchanged: nothing in
   * "fpsyg-09-00282" resembles a title, and the candidate is refused.
   */
  it("still refuses a publisher-default filename with no shape", function () {
    const verdict = accept(article(), "fpsyg-09-00282.pdf");
    assert.isFalse(verdict.ok);
    assert.include(verdict.reason, "title");
  });

  /**
   * The subtitle case, which is most of what the floor was refusing on the
   * real corpus: the filename holds the main title and the record's subtitle
   * is longer than the title it follows, so an exact match on the main
   * clause scores 0.35 against the whole thing.
   */
  it("accepts a filename that holds the main title without the subtitle", function () {
    const verdict = accept(
      article({
        title: [
          "Predictive processing in depression: Increased prediction error " +
            "following negative valence contexts and influence of depressive " +
            "symptom severity",
        ],
      }),
      "Kube et al. - 2021 - Predictive Processing in Depression.pdf",
    );
    assert.isTrue(verdict.ok, verdict.reason);
  });

  /**
   * The allowance has to stop at a work that merely shares an opening. A
   * corrigendum, a reply or a numbered continuation is its own Crossref
   * record with almost the same title, and accepting one files the paper
   * under the wrong record with no DOI to contradict it.
   */
  it("refuses a continuation or a notice that shares the title", function () {
    const filename = `Brockman et al. - 2021 - ${title}.pdf`;
    for (const candidate of [
      `${title}: part two, outcomes at twelve months`,
      `Corrigendum: ${title}`,
      `Reply to Gross: ${title}`,
    ]) {
      const verdict = accept(article({ title: [candidate] }), filename);
      assert.isFalse(verdict.ok, candidate);
      assert.equal(verdict.reason, "different work");
    }
  });

  /**
   * APA deposits a separate record for supplemental material, titled after
   * the paper. Four files in the 241-record corpus resolve to one, so the
   * notice rule deliberately leaves this shape alone.
   */
  it("still accepts a supplemental-material record", function () {
    const verdict = accept(
      article({ title: [`Supplemental Material for ${title}`] }),
      `Brockman et al. - 2021 - ${title}.pdf`,
    );
    assert.isTrue(verdict.ok, verdict.reason);
  });

  it("refuses a candidate that is not an article", function () {
    const verdict = accept(
      article({ type: "book-chapter" }),
      `Brockman et al. - 2021 - ${title}.pdf`,
    );
    assert.isFalse(verdict.ok);
    assert.equal(verdict.reason, "type=book-chapter");
  });

  it("refuses a candidate whose year disagrees with the filename", function () {
    const verdict = accept(
      article({ issued: { "date-parts": [[2015]] } }),
      `Brockman et al. - 2021 - ${title}.pdf`,
    );
    assert.isFalse(verdict.ok);
    assert.include(verdict.reason, "year 2021 vs 2015");
  });

  /**
   * Crossref indexes books poorly, so a book title routinely matches a later
   * work *about* the book with a high relevance score. The title floor is
   * what stops that, and parsing the title has not loosened it.
   */
  it("refuses a work about the book rather than the book", function () {
    const verdict = accept(
      article({
        title: ["A critical reappraisal of Brockman's emotion regulation work"],
      }),
      `Brockman et al. - 2021 - ${title}.pdf`,
    );
    assert.isFalse(verdict.ok);
    assert.include(verdict.reason, "title");
  });

  describe("a work about the work", function () {
    /**
     * Real, and the reason this test exists: "The Tao of Physics - Fritjof
     * Capra.pdf" was matched to Kauffman's 1977 review of the book in Isis.
     * Crossref's title for that review is the book's own title followed by
     * its author's name, so it scored 0.69 -- as high as the book itself
     * would have. Nothing in the filename disagreed, because a filename with
     * no year and no author in it has nothing to disagree with.
     */
    const review = {
      type: "journal-article",
      title: [
        "The Tao of Physics: An Exploration of the Parallels between " +
          "Modern Physics and Eastern Mysticism. Fritjof Capra",
      ],
      issued: { "date-parts": [[1977]] },
      author: [{ family: "Kauffman" }],
    };

    it("refuses a review when only the title agrees", function () {
      const verdict = accept(review, "The Tao of Physics - Fritjof Capra.pdf");
      assert.isFalse(verdict.ok);
      assert.include(verdict.reason, "only the title agrees");
    });

    it("accepts the same record once the filename carries its year", function () {
      // The rule asks for corroboration, not for a particular kind of it: a
      // filename that names the year this record was published is evidence
      // the title alone is not.
      const verdict = accept(
        review,
        "Kauffman - 1977 - The Tao of Physics.pdf",
      );
      assert.isTrue(verdict.ok, verdict.reason);
    });

    it("takes an author surname as corroboration when there is no year", function () {
      const article = {
        type: "journal-article",
        title: ["Allostasis: a model of predictive regulation"],
        issued: { "date-parts": [[2012]] },
        author: [{ family: "Sterling" }],
      };
      const verdict = accept(
        article,
        "Sterling - Allostasis a model of predictive regulation.pdf",
      );
      assert.isTrue(verdict.ok, verdict.reason);
    });

    it("refuses an interview with the author of the work", function () {
      // The residual case the corroboration rule alone could not catch: the
      // filename and the record share a person, so the person corroborates.
      // What separates them is the record announcing what it is.
      const interview = {
        type: "journal-article",
        title: ["Interview: Fritjof Capra"],
        issued: { "date-parts": [[1992]] },
        author: [{ family: "Capra" }, { family: "Kelly" }],
      };
      const verdict = accept(
        interview,
        "The Tao of Physics - Fritjof Capra.pdf",
      );
      assert.isFalse(verdict.ok);
      assert.include(verdict.reason, "different work");
    });

    it("does not take a two-letter surname as corroboration", function () {
      const article = {
        type: "journal-article",
        title: ["A theory of everything in particular"],
        issued: { "date-parts": [[1999]] },
        author: [{ family: "Li" }],
      };
      // "li" appears inside "particular"; a fragment that short is a
      // coincidence, not a name.
      const verdict = accept(
        article,
        "A theory of everything in particular.pdf",
      );
      assert.isFalse(verdict.ok);
      assert.include(verdict.reason, "only the title agrees");
    });
  });
});
