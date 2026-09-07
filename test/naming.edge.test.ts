import { assert } from "chai";
import {
  authorField,
  canonicalName,
  cleanField,
  surnameOf,
} from "../src/utils/naming";

/**
 * Adversarial cases for the filename builder.
 *
 * surnameOf exists because a creator's lastName field in a real library often
 * holds a whole name, so the function has to cope with free text. These cases
 * are the other free-text shapes that field holds, and the characters a title
 * can contain that a filename cannot.
 *
 * The two surname cases in here were written as failing tests against the
 * original implementation -- comma-form names and generational suffixes --
 * and are kept as the guard on the fix.
 */
describe("naming under adversarial input", function () {
  describe("surnameOf", function () {
    it("keeps a particle chain with the surname", function () {
      assert.equal(surnameOf("Ingrid van de Leemput"), "van de Leemput");
      assert.equal(surnameOf("Ludwig van Beethoven"), "van Beethoven");
    });

    it("leaves a hyphenated given name alone", function () {
      assert.equal(surnameOf("Anne-Marie Smith"), "Smith");
    });

    it("leaves an apostrophe surname alone", function () {
      assert.equal(surnameOf("Sean O'Brien"), "O'Brien");
    });

    /**
     * "Surname, Given" is a shape this field holds after a bad import or a
     * hand-typed entry. Read before the comma rather than walking in from
     * the right, which stopped at the comma-terminated surname and returned
     * the *given* name, so every filename was built around the wrong word.
     */
    it("takes the surname from a comma-form name", function () {
      assert.equal(surnameOf("Grimmer, Hilary"), "Grimmer");
      assert.equal(surnameOf("van de Leemput, I.A."), "van de Leemput");
      assert.equal(surnameOf("Smith, John Jr."), "Smith");
    });

    /** A generational suffix is the last token, not the surname. */
    it("does not mistake a generational suffix for the surname", function () {
      assert.equal(surnameOf("John Smith Jr."), "Smith");
      assert.equal(surnameOf("Martin Luther King Jr"), "King");
      assert.equal(surnameOf("Hendrik van der Berg III"), "van der Berg");
    });

    /** A name that is only a suffix has nothing better to return. */
    it("keeps something when a name is nothing but a suffix", function () {
      assert.equal(surnameOf("Jr."), "Jr.");
    });

    /**
     * A single token is returned as given, without trimming, so a padded
     * field carries its padding into the filename. Harmless but visible.
     */
    it("returns a single token verbatim, padding included", function () {
      assert.equal(surnameOf(" Smith "), " Smith ");
    });

    it("returns an all-lowercase two-token name whole", function () {
      // Every token before the last is lowercase, so the walk consumes them
      // all and the full string comes back. Correct for "van der Waals",
      // wrong for a carelessly lowercased "jane doe" -- and the function
      // cannot tell those apart.
      assert.equal(surnameOf("jane doe"), "jane doe");
    });
  });

  describe("authorField", function () {
    it("drops empty creators before deciding the shape", function () {
      assert.equal(authorField(["Smith", "", "Jones"]), "Smith and Jones");
      assert.equal(authorField(["", ""]), "");
    });
  });

  describe("canonicalName", function () {
    it("refuses rather than guessing when the title is only punctuation", function () {
      assert.isNull(canonicalName(["Smith"], "2020", "..."));
    });

    it("folds a newline in the title, which would break the filename", function () {
      assert.equal(
        canonicalName(["Smith"], "2020", "Line one\nline two"),
        "Smith - 2020 - Line one line two.pdf",
      );
    });

    /**
     * Only "/" is replaced, on the stated reasoning that it is the one
     * character a POSIX filename cannot hold. Zotero also runs on Windows,
     * where every character in this title is illegal in a filename and a
     * backslash is a path separator. The write will fail, or worse, land
     * somewhere unintended.
     */
    it("leaves characters that are illegal in a Windows filename", function () {
      assert.equal(
        canonicalName(["Smith"], "2020", 'Why? "Quotes" <and> |pipes| *stars*'),
        'Smith - 2020 - Why? "Quotes" <and> |pipes| *stars*.pdf',
      );
      assert.equal(
        canonicalName(["Smith"], "2020", "A\\B study"),
        "Smith - 2020 - A\\B study.pdf",
      );
    });

    it("truncates a single long word mid-word, having no boundary to use", function () {
      assert.equal(
        canonicalName(["Smith"], "2020", "Antidisestablishmentarianism", 10),
        "Smith - 2020 - Antidisest.pdf",
      );
    });

    it("does not truncate a title of exactly the limit", function () {
      const title = "w".repeat(100);
      assert.equal(
        canonicalName(["Smith"], "2020", title),
        `Smith - 2020 - ${title}.pdf`,
      );
    });

    /**
     * The year is passed through as text, so a non-numeric date lands in the
     * filename as written. filenameParts only recognises a four-digit year,
     * so a file named this way will not parse back into its parts later.
     */
    it("passes a non-numeric year through unchecked", function () {
      assert.equal(
        canonicalName(["Smith"], "n.d.", "Some Title"),
        "Smith - n.d. - Some Title.pdf",
      );
    });

    it("collapses the whitespace a Crossref title carries", function () {
      assert.equal(
        cleanField("  A  title\twith\nnoise  "),
        "A title with noise",
      );
    });
  });

  describe("cleanField on publisher markup", function () {
    /**
     * Both strings are real: the first came back from Crossref for
     * 10.1111/aas.70281, the second for 10.1109/TNSRE.2026.3711533. Left in,
     * the tags reach the item's title field and, through canonicalName, the
     * name of the file on disk.
     */
    it("strips the JATS tags a publisher deposits", function () {
      assert.equal(
        cleanField(
          "Association of Age, Sex and\n      <scp>ASA</scp>\n" +
            "      Physical Status With Bispectral Index Values",
        ),
        "Association of Age, Sex and ASA Physical Status With Bispectral Index Values",
      );
    });

    it("closes the gap the removed tag was holding open", function () {
      assert.equal(
        cleanField(
          "Anesthesia Depth Using EEG <i>\u03b1</i> -Spindle Dynamics",
        ),
        "Anesthesia Depth Using EEG \u03b1-Spindle Dynamics",
      );
    });

    it("leaves a hyphen used as a separator alone", function () {
      // A space on both sides is a separator between two parts of a title, not
      // the artefact of a tag; and a title carrying no markup is not touched.
      assert.equal(
        cleanField("<i>Attention</i> - Performance - A Review"),
        "Attention - Performance - A Review",
      );
      assert.equal(
        cleanField("Anxiety - Performance"),
        "Anxiety - Performance",
      );
    });

    it("does not treat a bare < in a title as markup", function () {
      // "<...>" is never stripped wholesale: a blanket strip would swallow
      // everything between a real "<" and the next ">".
      assert.equal(
        cleanField("Effects were significant at p < 0.05 (n > 40)"),
        "Effects were significant at p < 0.05 (n > 40)",
      );
    });

    it("resolves character references", function () {
      assert.equal(cleanField("Rock &amp; Roll"), "Rock & Roll");
      assert.equal(cleanField("Caf&#233; culture"), "Caf\u00e9 culture");
      assert.equal(cleanField("&#x3b1; oscillations"), "\u03b1 oscillations");
    });

    it("keeps an escaped tag the author wrote as text", function () {
      // Entities are resolved after the tags are gone, so this survives as the
      // literal characters rather than becoming markup and vanishing.
      assert.equal(cleanField("The &lt;i&gt; element"), "The <i> element");
    });

    it("still collapses the whitespace it always did", function () {
      assert.equal(
        cleanField("  A  title\twith\nnoise  "),
        "A title with noise",
      );
      assert.equal(cleanField(null), "");
    });
  });
});
