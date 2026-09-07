import { config } from "../package.json";
import hooks from "./hooks";
import * as annotations from "./modules/annotations";
import * as cancel from "./utils/cancel";
import * as crossref from "./modules/crossref";
import * as folderIntake from "./modules/folderIntake";
import * as folders from "./utils/folders";
import * as intake from "./modules/intake";
import * as pdfText from "./modules/pdfText";
import * as reconcile from "./modules/reconcile";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: { current: any };
    prefs?: { window: Window };
    /** Windows this plugin opened, so a second invocation focuses rather than duplicates. */
    windows: { intake?: Window; annotations?: Window; reconcile?: Window };
    /**
     * A folder and a list of filenames left here by one window for another to
     * pick up. Reconcile uses it to send its unmatched files to intake, which
     * may already be open and so runs no new code when it is merely focused.
     */
    handoff?: { folder: string; names: string[] } | null;
  };

  public hooks: typeof hooks;

  /** Reachable from plugin windows as Zotero[config.addonInstance].api. */
  public api: {
    annotations: typeof annotations;
    cancel: typeof cancel;
    crossref: typeof crossref;
    folderIntake: typeof folderIntake;
    folders: typeof folders;
    intake: typeof intake;
    pdfText: typeof pdfText;
    reconcile: typeof reconcile;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      handoff: null,
      ztoolkit: createZToolkit(),
      windows: {},
    };
    this.hooks = hooks;
    this.api = {
      annotations,
      cancel,
      crossref,
      folderIntake,
      folders,
      intake,
      pdfText,
      reconcile,
    };
  }
}

export default Addon;
