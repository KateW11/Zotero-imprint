import { config } from "../package.json";
import hooks from "./hooks";
import * as crossref from "./modules/crossref";
import * as folderIntake from "./modules/folderIntake";
import * as intake from "./modules/intake";
import * as mirror from "./modules/mirror";
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
    windows: { intake?: Window; mirror?: Window; reconcile?: Window };
  };

  public hooks: typeof hooks;

  /** Reachable from plugin windows as Zotero[config.addonInstance].api. */
  public api: {
    crossref: typeof crossref;
    folderIntake: typeof folderIntake;
    intake: typeof intake;
    mirror: typeof mirror;
    pdfText: typeof pdfText;
    reconcile: typeof reconcile;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
      windows: {},
    };
    this.hooks = hooks;
    this.api = { crossref, folderIntake, intake, mirror, pdfText, reconcile };
  }
}

export default Addon;
