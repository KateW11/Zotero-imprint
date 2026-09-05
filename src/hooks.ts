import { config } from "../package.json";
import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { registerMenu, unregisterMenu } from "./modules/menu";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: config.addonName,
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
  });

  // The windows first: registering a menu whose labels come from a locale
  // file the window has not loaded yet leaves the label permanently empty,
  // because Fluent does not retry an element it has already failed to resolve.
  await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));

  // Registered once for the application, not per window.
  registerMenu();

  // Read from outside the plugin (scaffold's test runner checks this).
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // One toolkit instance per window.
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-addon.ftl`);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  closePluginWindows();
  unregisterMenu();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - plugin instance is not typed
  delete Zotero[config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

/**
 * Plugin windows hold references into this plugin's sandbox. A reload during
 * development tears the sandbox down, so any window left open would be talking
 * to a dead object -- close them on shutdown.
 */
function closePluginWindows() {
  for (const key of Object.keys(addon.data.windows) as Array<
    keyof typeof addon.data.windows
  >) {
    try {
      addon.data.windows[key]?.close();
    } catch {
      // already gone
    }
    delete addon.data.windows[key];
  }
}

function openPluginWindow(
  name: keyof typeof addon.data.windows,
  file: string,
  features: string,
) {
  const existing = addon.data.windows[name];
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }
  addon.data.windows[name] = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/${file}`,
    `${config.addonRef}-${name}`,
    features,
  ) as Window;
}

function onIntakeCommand() {
  openPluginWindow(
    "intake",
    "intake.xhtml",
    "chrome,centerscreen,resizable,dialog=no,width=1100,height=720",
  );
}

function onMirrorCommand() {
  openPluginWindow(
    "mirror",
    "mirror.xhtml",
    "chrome,centerscreen,resizable,dialog=no,width=960,height=640",
  );
}

function onReconcileCommand() {
  openPluginWindow(
    "reconcile",
    "reconcile.xhtml",
    "chrome,centerscreen,resizable,dialog=no,width=1000,height=700",
  );
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  onIntakeCommand,
  onMirrorCommand,
  onReconcileCommand,
};
