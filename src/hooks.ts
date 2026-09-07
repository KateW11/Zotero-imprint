import { config } from "../package.json";
import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { registerMenu, unregisterMenu } from "./modules/menu";
import { createZToolkit } from "./utils/ztoolkit";
import { sweepTemporaryAttachments } from "./modules/pdfText";

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
  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Registered once for the application, not per window.
  registerMenu();

  // A read through the slow route links the file into the library for the
  // length of the read. A quit mid-scan would leave that attachment behind,
  // so anything still tagged from a previous session goes now.
  sweepTemporaryAttachments()
    .then((n) => {
      if (n)
        Zotero.debug(`Imprint: removed ${n} leftover temporary attachment(s)`);
    })
    .catch((e) => Zotero.debug(`Imprint: sweep failed: ${e}`));

  // Read from outside the plugin (scaffold's test runner checks this).
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // One toolkit for the plugin, created with the addon and left alone.
  //
  // The template makes a fresh one per window and stores it in the same
  // field, so with two main windows open the second load replaced the
  // instance the first was using, and closing either one unregistered
  // whatever instance was current. Nothing here registers window-specific UI
  // through the toolkit -- the menu is registered application-wide through
  // Zotero.MenuManager, and the toolkit is used for the file picker, the
  // progress window and locale lookup -- so one instance is correct.
  if (!addon.data.ztoolkit) addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-addon.ftl`);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  // Nothing to do per window. The plugin's registrations belong to the
  // application, not to a window, and are released in onShutdown;
  // unregistering them from here meant closing one main window left the
  // other one without the plugin's menu.
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

/**
 * A handoff is a folder and a list of filenames another window wants intake
 * to work on. It is left on the plugin rather than passed in, because intake
 * may already be open -- and a window that is only focused runs no new code,
 * so it has to be told to look.
 */
function onIntakeCommand(handoff?: { folder: string; names: string[] }) {
  if (handoff) addon.data.handoff = handoff;

  const existing = addon.data.windows.intake;
  const wasOpen = !!existing && !existing.closed;

  openPluginWindow(
    "intake",
    "intake.xhtml",
    "chrome,centerscreen,resizable,dialog=no,width=1100,height=720",
  );

  if (wasOpen && handoff) {
    // The window's own view object, declared nowhere TypeScript can see.
    (existing as any)?.IntakeWindow?.takeHandoff?.();
  }
}

function onAnnotationsCommand() {
  openPluginWindow(
    "annotations",
    "annotations.xhtml",
    "chrome,centerscreen,resizable,dialog=no,width=1000,height=680",
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
  onAnnotationsCommand,
  onReconcileCommand,
};
