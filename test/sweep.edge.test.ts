import { assert } from "chai";
import {
  TEMP_ATTACHMENT_TAG,
  sweepTemporaryAttachments,
} from "../src/modules/pdfText";

/**
 * The startup sweep for temporary attachments.
 *
 * The slow PDF-reading route links the file into the library for the length
 * of one read and erases it in a `finally`, which covers an error but not a
 * quit mid-scan. This sweep is what removes what a quit left behind -- and
 * because it erases items, what it must NOT touch matters more than what it
 * does: a stub library here stands in for the user's.
 */
describe("sweepTemporaryAttachments", function () {
  let original: unknown;
  let erased: string[] = [];
  let conditions: unknown[][] = [];

  const fakeItem = (
    name: string,
    opts: { attachment?: boolean; linked?: boolean; throws?: boolean } = {},
  ) => ({
    name,
    isAttachment: () => opts.attachment !== false,
    attachmentLinkMode: opts.linked === false ? 1 : 2,
    eraseTx: async () => {
      if (opts.throws) throw new Error("locked");
      erased.push(name);
    },
  });

  function install(items: unknown[], searchThrows = false) {
    erased = [];
    conditions = [];
    globalThis.Zotero = {
      debug: () => undefined,
      Libraries: { userLibraryID: 1 },
      Attachments: { LINK_MODE_LINKED_FILE: 2 },
      Items: { getAsync: async () => items },
      Search: class {
        libraryID = 0;
        addCondition(...args: unknown[]) {
          conditions.push(args);
        }
        async search() {
          if (searchThrows) throw new Error("no such condition");
          return items.length ? items.map((_, i) => i + 1) : [];
        }
      },
    } as never;
  }

  before(function () {
    original = globalThis.Zotero;
  });

  afterEach(function () {
    globalThis.Zotero = original as never;
  });

  it("erases a tagged linked-file attachment and reports the count", async function () {
    install([fakeItem("left over"), fakeItem("also left over")]);
    assert.equal(await sweepTemporaryAttachments(), 2);
    assert.deepEqual(erased, ["left over", "also left over"]);
  });

  it("searches the user library for the tag and nothing else", async function () {
    install([fakeItem("left over")]);
    await sweepTemporaryAttachments();
    assert.deepEqual(conditions, [["tag", "is", TEMP_ATTACHMENT_TAG]]);
  });

  /**
   * The tag is not a name anyone would type, but a real item carrying it --
   * or a stored attachment, which holds a copy of the file rather than a
   * link -- must survive, because erasing one destroys the user's work.
   */
  it("leaves a regular item and a stored attachment alone", async function () {
    install([
      fakeItem("a real paper", { attachment: false }),
      fakeItem("an imported copy", { linked: false }),
    ]);
    assert.equal(await sweepTemporaryAttachments(), 0);
    assert.deepEqual(erased, []);
  });

  it("carries on past one item it cannot erase", async function () {
    install([fakeItem("locked", { throws: true }), fakeItem("fine")]);
    assert.equal(await sweepTemporaryAttachments(), 1);
    assert.deepEqual(erased, ["fine"]);
  });

  it("reports nothing removed when the search itself fails", async function () {
    install([fakeItem("left over")], true);
    assert.equal(await sweepTemporaryAttachments(), 0);
    assert.deepEqual(erased, []);
  });

  it("does nothing when the library is clean", async function () {
    install([]);
    assert.equal(await sweepTemporaryAttachments(), 0);
  });
});
