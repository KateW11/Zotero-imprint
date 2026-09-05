import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";

const MENU_ID = `${config.addonRef}-tools`;

/**
 * A submenu under Tools, via Zotero's own menu API.
 *
 * The toolkit's Menu helper was removed in zotero-plugin-toolkit 5, because
 * Zotero 8 added Zotero.MenuManager. This registers once for the whole
 * application rather than per window, and Zotero takes the menu back out
 * when the plugin is disabled.
 */
export function registerMenu() {
  // Belt and braces on the ordering above: whatever calls this, every window
  // has the locale file before a single menu element exists.
  for (const win of Zotero.getMainWindows()) {
    try {
      win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-addon.ftl`);
    } catch (e) {
      Zotero.debug(`Imprint: could not load the locale file: ${e}`);
    }
  }

  Zotero.MenuManager.registerMenu({
    menuID: MENU_ID,
    pluginID: config.addonID,
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "submenu",
        l10nID: getLocaleID("menu-imprint-label"),
        menus: [
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menuitem-intake-label"),
            onCommand: () => addon.hooks.onIntakeCommand(),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menuitem-mirror-label"),
            onCommand: () => addon.hooks.onMirrorCommand(),
          },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menuitem-reconcile-label"),
            onCommand: () => addon.hooks.onReconcileCommand(),
          },
        ],
      },
    ],
  });
}

export function unregisterMenu() {
  Zotero.MenuManager.unregisterMenu(MENU_ID);
}
