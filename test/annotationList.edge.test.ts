import { assert } from "chai";
import { render, AnnotationEntry } from "../src/modules/annotationList";

/**
 * The annotation list writer, on the highlight text a real paper contains.
 *
 * A highlight is arbitrary text from someone else's PDF, and the CSV goes
 * straight into a spreadsheet. A cell beginning with =, +, - or @ is a
 * formula there, not text.
 */
describe("annotation list rendering", function () {
  const entry = (over: Partial<AnnotationEntry> = {}): AnnotationEntry => ({
    key: "AAAA1111",
    type: "highlight",
    text: "reappraisal predicted lower negative affect",
    comment: "",
    colour: "yellow",
    page: "4",
    tags: [],
    link: "zotero://open-pdf/library/items/AAAA1111",
    ...over,
  });

  it("neutralises a highlight a spreadsheet would evaluate", function () {
    const out = render(
      "Brockman et al. - 2021 - Emotion regulation",
      [entry({ text: '=HYPERLINK("http://example.com","click")' })],
      "csv",
    );
    assert.include(out, "\"'=HYPERLINK(");
    assert.notInclude(out, '"=HYPERLINK(');
  });

  it("neutralises the other three formula leaders, in text and comment", function () {
    for (const leader of ["+", "-", "@"]) {
      const out = render(
        "paper",
        [entry({ text: `${leader}1+1`, comment: `${leader}cmd|calc` })],
        "csv",
      );
      assert.include(out, `"'${leader}1+1"`, leader);
      assert.include(out, `"'${leader}cmd|calc"`, leader);
    }
  });

  it("leaves ordinary text alone", function () {
    const out = render("paper", [entry()], "csv");
    assert.include(out, '"reappraisal predicted lower negative affect"');
    assert.notInclude(out, "'reappraisal");
  });

  it("still escapes a quote and keeps a comma inside the cell", function () {
    const out = render(
      "paper",
      [entry({ text: 'they call it "reappraisal", broadly' })],
      "csv",
    );
    assert.include(out, '"they call it ""reappraisal"", broadly"');
  });

  /** The mitigation is a spreadsheet convention, so only the CSV carries it. */
  it("does not add an apostrophe to the other formats", function () {
    const rows = [entry({ text: "=1+1" })];
    assert.include(render("paper", rows, "markdown"), "=1+1");
    assert.notInclude(render("paper", rows, "markdown"), "'=1+1");
    assert.include(render("paper", rows, "text"), "=1+1");
    assert.notInclude(render("paper", rows, "text"), "'=1+1");
  });
});
