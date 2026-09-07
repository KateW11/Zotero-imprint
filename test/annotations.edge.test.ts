import { assert } from "chai";
import { exportDir } from "../src/modules/annotations";

/**
 * The export destination guard.
 *
 * Exported filenames are built by the same canonicalName() that names filed
 * PDFs, so a destination that holds filed PDFs collides with them by rule
 * rather than by accident -- and both write paths overwrite without asking.
 * These cases fix which folders are refused and which are allowed, including
 * the plugin's own default, a subfolder of staging.
 */

const STAGING = "/Users/test/Papers/Staging";
const DROP = "/Users/test/Downloads/Papers";
const DATA_DIR = "/Users/test/Zotero";

/** Stand in for the prefs branch and the data directory Zotero reports. */
function withPrefs(values: Record<string, string>) {
  (globalThis as any).Zotero.Prefs = {
    // Keys arrive fully qualified: "extensions.zotero.imprint.stagingDir".
    get: (key: string) => values[String(key).split(".").pop() ?? ""] ?? "",
    set: () => undefined,
  };
  (globalThis as any).Zotero.DataDirectory = { dir: DATA_DIR };
  (globalThis as any).PathUtils = {
    join: (...parts: string[]) => parts.join("/"),
  };
}

describe("annotation export destination", function () {
  it("defaults to a subfolder of staging", function () {
    withPrefs({ stagingDir: STAGING });
    assert.equal(exportDir(), `${STAGING}/Annotated`);
  });

  it("allows that same subfolder when it is chosen outright", function () {
    withPrefs({
      stagingDir: STAGING,
      annotationsDir: `${STAGING}/Annotated`,
    });
    assert.equal(exportDir(), `${STAGING}/Annotated`);
  });

  it("refuses the staging folder itself", function () {
    withPrefs({ stagingDir: STAGING, annotationsDir: STAGING });
    assert.throws(exportDir, /staging folder/);
  });

  it("refuses it however the path is spelled", function () {
    withPrefs({ stagingDir: STAGING, annotationsDir: `${STAGING}/` });
    assert.throws(exportDir, /staging folder/);
  });

  it("refuses the folder new PDFs are dropped in", function () {
    withPrefs({
      stagingDir: STAGING,
      sourceDir: DROP,
      annotationsDir: DROP,
    });
    assert.throws(exportDir, /dropped in/);
  });

  it("refuses anywhere inside the Zotero data folder", function () {
    withPrefs({
      stagingDir: STAGING,
      annotationsDir: `${DATA_DIR}/storage/ABCD2345`,
    });
    assert.throws(exportDir, /Zotero data folder/);
  });

  it("applies the same guard to the folder held in settings", function () {
    withPrefs({ stagingDir: STAGING, mirrorDir: STAGING });
    assert.throws(exportDir, /staging folder/);
  });

  it("allows an ordinary folder that holds nothing of Zotero's", function () {
    withPrefs({
      stagingDir: STAGING,
      annotationsDir: "/Users/test/Dropbox/Annotated",
    });
    assert.equal(exportDir(), "/Users/test/Dropbox/Annotated");
  });
});
