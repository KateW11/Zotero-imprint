import { config } from "../../package.json";

const FOLDER_PREFS = ["sourceDir", "stagingDir", "mirrorDir"] as const;

export async function registerPrefsScripts(_window: Window) {
  addon.data.prefs = { window: _window };
  bindFolderPickers(_window);
}

/**
 * Wire each "Choose..." button to a folder picker that writes the chosen path
 * into its text field. The field stays editable -- typing a path by hand and
 * picking one land in the same place.
 */
function bindFolderPickers(win: Window) {
  for (const key of FOLDER_PREFS) {
    const input = win.document.querySelector(
      `#zotero-prefpane-${config.addonRef}-${key}`,
    ) as HTMLInputElement | null;
    const button = win.document.querySelector(
      `#zotero-prefpane-${config.addonRef}-${key}-browse`,
    );
    if (!input || !button) continue;

    button.addEventListener("command", async () => {
      const picked = await new ztoolkit.FilePicker(
        "Choose a folder",
        "folder",
      ).open();
      if (!picked) return;
      input.value = picked as string;
      // The preference binding listens for input/change, not assignment.
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
    });
  }
}
