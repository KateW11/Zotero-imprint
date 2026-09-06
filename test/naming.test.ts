import { assert } from "chai";
import {
  authorField,
  canonicalName,
  cleanField,
  surnameOf,
} from "../src/utils/naming";

describe("surnameOf", function () {
  it("keeps lowercase particles with the surname", function () {
    // Splitting on the last token gives "Leemput", which matches nothing
    assert.equal(surnameOf("Ingrid van de Leemput"), "van de Leemput");
    assert.equal(surnameOf("Han van der Maas"), "van der Maas");
  });

  it("returns a bare surname unchanged", function () {
    assert.equal(surnameOf("Barrett"), "Barrett");
  });

  it("takes the last name from a full name", function () {
    assert.equal(surnameOf("Lisa Feldman Barrett"), "Barrett");
  });
});

describe("authorField", function () {
  it("names one, joins two, and abbreviates three or more", function () {
    assert.equal(authorField(["Barrett"]), "Barrett");
    assert.equal(authorField(["Arksey", "O'Malley"]), "Arksey and O'Malley");
    assert.equal(
      authorField(["Scheffer", "Bascompte", "Brock"]),
      "Scheffer et al.",
    );
  });

  it("is empty when there are no creators", function () {
    assert.equal(authorField([]), "");
  });
});

describe("cleanField", function () {
  it("collapses the whitespace Crossref titles carry", function () {
    // A newline in a title breaks YAML frontmatter downstream
    assert.equal(cleanField("Two  spaces\nand a break"), "Two spaces and a break");
  });
});

describe("canonicalName", function () {
  it("builds the convention the folder already uses", function () {
    assert.equal(
      canonicalName(["Barrett"], "2017", "Theory of Constructed Emotion"),
      "Barrett - 2017 - Theory of Constructed Emotion.pdf",
    );
  });

  it("refuses rather than guessing when a part is missing", function () {
    assert.isNull(canonicalName([], "2017", "A Title"));
    assert.isNull(canonicalName(["Barrett"], "", "A Title"));
    assert.isNull(canonicalName(["Barrett"], "2017", ""));
  });

  it("truncates a long title at a word boundary, not mid-word", function () {
    const long =
      "A Manifesto on Psychology as Idiographic Science: Bringing the Person " +
      "Back Into Scientific Psychology, This Time Forever";
    const name = canonicalName(["Molenaar"], "2004", long);
    assert.isNotNull(name);
    assert.isTrue(name!.length <= 120);
    assert.notInclude(name!, "Scientif.");
    assert.isFalse(/\s\.pdf$/.test(name!));
  });

  it("replaces the one character a filename cannot hold", function () {
    const name = canonicalName(["Kolk"], "1990", "Adaptation/impairment");
    assert.include(name!, "Adaptation-impairment");
  });

  it("keeps colons, which real filenames do have", function () {
    const name = canonicalName(["Sterling"], "2012", "Allostasis: a model");
    assert.include(name!, "Allostasis: a model");
  });
});
