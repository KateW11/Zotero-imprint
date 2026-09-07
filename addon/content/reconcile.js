/* View layer for reconcile. The work is in the plugin's reconcile module,
 * reached through Zotero.__addonInstance__.api. */

var Zotero =
  window.opener?.Zotero ||
  Components.classes["@zotero.org/Zotero;1"].getService(
    Components.interfaces.nsISupports,
  ).wrappedJSObject;

var ReconcileWindow = {
  report: null,
  scopePicker: null,

  api() {
    const addon = Zotero.__addonInstance__;
    if (!addon?.data?.alive) {
      throw new Error(
        "The plugin was reloaded. Close this window and open it again.",
      );
    }
    return addon.api;
  },

  /** Reached separately from the api, to ask the plugin to open a window. */
  hooks() {
    const addon = Zotero.__addonInstance__;
    if (!addon?.data?.alive) {
      throw new Error(
        "The plugin was reloaded. Close this window and open it again.",
      );
    }
    return addon.hooks;
  },

  scope() {
    const picked = document.querySelector('input[name="scope"]:checked');
    return picked ? picked.value : "library";
  },

  scopeCollectionID() {
    if (this.scope() !== "collection") return null;
    return Picker.collectionID(this.scopePicker);
  },

  scopeChanged() {
    this.$("scopeCollection").hidden = this.scope() !== "collection";
  },

  $(id) {
    return document.getElementById(id);
  },

  pref(name) {
    return (
      Zotero.Prefs.get("extensions.zotero.imprint." + name, true) || ""
    ).trim();
  },

  /**
   * Which folder to compare against: whatever was last chosen here, falling
   * back to the staging folder from settings. Kept as its own preference so
   * checking another folder does not move where intake files things.
   */
  folder() {
    return this.pref("reconcileDir") || this.pref("stagingDir");
  },

  async chooseFolder() {
    const picked = await this.api().folders.pickFolder("Folder to reconcile");
    if (!picked) return;
    Zotero.Prefs.set("extensions.zotero.imprint.reconcileDir", picked, true);
    this.folderChanged();
  },

  useStagingFolder() {
    Zotero.Prefs.set("extensions.zotero.imprint.reconcileDir", "", true);
    this.folderChanged();
  },

  /** The report on screen belongs to the old folder, so clear it. */
  folderChanged() {
    this.report = null;
    this.$("sections").textContent = "";
    this.$("summary").textContent = "";
    this.showError("");
    this.refreshFolder();
    this.setBusy(false);
  },

  refreshFolder() {
    const dir = this.folder();
    // The path is ellipsised to share the row with the buttons.
    this.$("dir").title = dir;
    this.$("dir").textContent =
      dir ||
      "(no folder set — choose one, or set a staging folder in settings)";
    this.$("useStaging").disabled = !this.pref("reconcileDir");
  },

  init() {
    this.scopePicker = Picker.install(this.$("scopeCollection"), {
      entries: Picker.collectionEntries(this.api().intake.collections()),
      empty: "This library has no collections.",
    });
    this.refreshFolder();
    this.setBusy(false);
  },

  showError(message) {
    const box = this.$("error");
    box.textContent = message;
    box.hidden = !message;
  },

  setBusy(busy) {
    this.$("stop").disabled = !busy;
    if (!busy) this.$("stop").textContent = "Stop";
    this.$("run").disabled = busy || !this.folder();
    this.$("choose").disabled = busy;
    this.$("useStaging").disabled = busy || !this.pref("reconcileDir");
    this.$("copy").disabled = busy || !this.report;
    this.$("rescanAll").disabled = busy;
    this.$("toIntake").disabled = busy || !this.unmatched().length;
  },

  /**
   * Ask the run to stop. It finishes the file it is on and then gives back
   * what it has, so nothing is left half written. The button disables itself
   * at once: asking twice does nothing, and a button that still looks live
   * reads as though the first click missed.
   */
  stop() {
    this.$("stop").disabled = true;
    this.$("stop").textContent = "Stopping\u2026";
    try {
      this.api().cancel.requestStop();
    } catch (e) {
      this.showError(String(e.message || e));
    }
  },

  async run() {
    this.setBusy(true);
    this.showError("");
    this.$("summary").textContent = "Reading the folder...";
    this.$("sections").textContent = "";
    try {
      this.report = await this.api().reconcile.reconcile(this.folder(), {
        rescanAll: this.$("rescanAll").checked,
        collectionID: this.scopeCollectionID(),
        onProgress: (done, total, name) => {
          this.$("summary").textContent =
            `Reading ${done} of ${total} — ${name.slice(0, 60)}`;
        },
      });
      this.render();
    } catch (e) {
      // A stopped reconcile has nothing to show. Its answer is a comparison
      // in both directions, and half of one would report every item it had
      // not reached yet as having no copy in the folder -- a wrong answer
      // rather than a shorter one.
      if (e && e.name === "Stopped") {
        this.report = null;
        this.$("summary").textContent =
          "Stopped. Nothing to report — reconcile only means anything whole.";
      } else {
        this.showError(String(e.message || e));
        this.$("summary").textContent = "";
      }
    } finally {
      this.setBusy(false);
    }
  },

  render() {
    const r = this.report;
    this.$("summary").textContent =
      `${r.files} PDFs in the folder · ${r.items} items in ${r.scope} · ${r.matched} matched`;

    const host = this.$("sections");
    host.textContent = "";

    if (!r.storageChecked) {
      const warn = document.createElement("div");
      warn.className = "error";
      warn.textContent = `Storage folder not found at ${r.storage}, so attachment files were not checked.`;
      host.append(warn);
    }

    // Scoped to a collection, "no item here" is mostly files that are simply
    // filed elsewhere. Separating them keeps the papers the library has never
    // seen from being buried under them.
    const unknown = r.folderOnly.filter((x) => !x.elsewhere);
    const elsewhere = r.folderOnly.filter((x) => x.elsewhere);
    const withDoi = (x) => x.name + (x.doi ? "  —  " + x.doi : "");

    this.section(
      host,
      "In the folder, not in the library at all",
      unknown,
      withDoi,
    );
    if (elsewhere.length) {
      this.section(
        host,
        `In the folder and in the library, but not in ${r.scope}`,
        elsewhere,
        withDoi,
        null,
        (x) => x.elsewhere,
      );
    }

    this.section(
      host,
      `In ${r.scope}, no copy in the folder`,
      r.libraryOnly,
      (x) => x.title,
      (x) => x.key,
      (x) => (x.hasPdf ? "" : "no PDF in Zotero either"),
    );

    this.section(
      host,
      "Attachment rows whose file is missing on disk",
      r.broken,
      (x) => x.title,
      (x) => x.key,
      (x) => x.filename,
    );

    this.section(
      host,
      `Items in ${r.scope} with no PDF attached`,
      r.noPdf,
      (x) => x.title,
      (x) => x.key,
    );
  },

  section(host, title, rows, text, key, note) {
    const sec = document.createElement("section");
    const h = document.createElement("h2");
    h.textContent = `${title} (${rows.length})`;
    sec.append(h);

    const ul = document.createElement("ul");
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "none";
      li.textContent = "None.";
      ul.append(li);
    } else {
      for (const row of rows) {
        const li = document.createElement("li");
        if (key) {
          const k = document.createElement("span");
          k.className = "key";
          k.textContent = key(row);
          li.append(k);
        }
        li.append(document.createTextNode(text(row)));
        const n = note?.(row);
        if (n) {
          const span = document.createElement("span");
          span.className = "note";
          span.textContent = "  (" + n + ")";
          li.append(span);
        }
        ul.append(li);
      }
    }
    sec.append(ul);
    host.append(sec);
  },

  /**
   * Files in the folder that no item was found for at all. The ones filed
   * elsewhere in the library are deliberately left out: intake would only
   * report that they are already held.
   */
  unmatched() {
    return this.report
      ? this.report.folderOnly.filter((x) => !x.elsewhere)
      : [];
  },

  /**
   * Hand those files to Intake. The folder and the filenames go on the plugin
   * rather than through the window, because Intake may already be open and a
   * window that is merely focused runs no new code of its own.
   */
  sendToIntake() {
    const files = this.unmatched();
    if (!files.length) return;
    this.hooks().onIntakeCommand({
      folder: this.folder(),
      names: files.map((f) => f.name),
    });
  },

  copyMarkdown() {
    if (!this.report) return;
    const md = this.api().reconcile.asMarkdown(this.report, this.folder());
    Zotero.Utilities.Internal.copyTextToClipboard(md);
    this.$("summary").textContent += "   — report copied to the clipboard";
  },
};
