/* View layer for intake. The work is in the plugin's intake module, reached
 * through Zotero.__addonInstance__.api. */

var Zotero =
  window.opener?.Zotero ||
  Components.classes["@zotero.org/Zotero;1"].getService(
    Components.interfaces.nsISupports,
  ).wrappedJSObject;

/** What each status means, for the legend under the summary. */
const STATUS_HELP = {
  new: "no item for this paper yet — one will be created",
  attach: "the item is in your library without a PDF — this file gets attached",
  "already has PDF":
    "that item already holds a PDF, so this file is left alone",
  supplement:
    "a paper's supplementary material, not a paper — attach it yourself",
  duplicate:
    "the same paper as another file in this batch — only the first is filed",
  "needs you": "nothing confident enough to act on without you looking",
  "checks out": "the DOI inside the file agrees with the item it is on",
  "item has no DOI": "the item carries no DOI, and the file's DOI resolves",
  "disagrees with the file": "the file's DOI resolves to a different paper",
  "cannot verify":
    "no DOI inside the file, so there is nothing to check against",
};

var IntakeWindow = {
  rows: [],
  filePicker: null,
  sourcePicker: null,
  /** Set when reconcile hands a specific folder and file list over. */
  handoff: null,

  addon() {
    const addon = Zotero.__addonInstance__;
    if (!addon?.data?.alive) {
      throw new Error(
        "The plugin was reloaded. Close this window and open it again.",
      );
    }
    return addon;
  },

  source() {
    const picked = document.querySelector('input[name="source"]:checked');
    return picked ? picked.value : "zotero";
  },

  /** Whichever module matches the chosen source. Both expose scan and apply. */
  api() {
    const which = this.source() === "folder" ? "folderIntake" : "intake";
    return this.addon().api[which];
  },

  /** The collection to read from, when the source is a collection. */
  sourceCollectionID() {
    if (this.source() !== "collection") return null;
    return Picker.collectionID(this.sourcePicker);
  },

  $(id) {
    return document.getElementById(id);
  },

  pref(name) {
    return (
      Zotero.Prefs.get("extensions.zotero.imprint." + name, true) || ""
    ).trim();
  },

  setPref(name, value) {
    Zotero.Prefs.set("extensions.zotero.imprint." + name, value, true);
  },

  /**
   * Read another folder for this run. Its own preference, so working
   * through a different folder once does not move the source folder in
   * settings -- and it replaces anything reconcile handed over.
   */
  async chooseFolder() {
    const picked = await this.addon().api.folders.pickFolder(
      "Folder to read PDFs from",
    );
    if (!picked) return;
    this.handoff = null;
    this.setPref("intakeDir", picked);
    this.sourceChanged();
  },

  useSettingsFolder() {
    this.handoff = null;
    this.setPref("intakeDir", "");
    this.sourceChanged();
  },

  init() {
    const collections = this.addon().api.intake.collections();

    this.filePicker = Picker.install(this.$("collections"), {
      entries: Picker.collectionEntries(collections, "(no collection)"),
    });
    this.sourcePicker = Picker.install(this.$("sourceCollection"), {
      entries: Picker.collectionEntries(collections),
      empty: "This library has no collections.",
    });

    // sourceChanged first: takeHandoff has a summary line of its own to leave
    // on screen, and sourceChanged would overwrite it.
    this.sourceChanged();
    this.takeHandoff();
  },

  /**
   * Reconcile can send its unmatched files here. It leaves the folder and the
   * filenames on the plugin, because a window it did not open has no other
   * way to be told.
   */
  takeHandoff() {
    const pending = this.addon().data.handoff;
    if (!pending) return;
    this.addon().data.handoff = null;
    this.handoff = pending;

    const folder = document.querySelector(
      'input[name="source"][value="folder"]',
    );
    if (folder) folder.checked = true;
    this.sourceChanged();
    this.$("summary").textContent =
      `${pending.names.length} ${pending.names.length === 1 ? "file" : "files"} ` +
      "sent over from Reconcile. Press Scan to identify them.";
    window.focus();
  },

  sourceChanged() {
    this.rows = [];
    this.$("rows").textContent = "";
    this.$("legend").textContent = "";
    this.$("log").hidden = true;
    this.showError("");

    const source = this.source();
    this.$("sourceCollectionBar").hidden = source !== "collection";
    this.$("sourceFolderBar").hidden = source !== "folder";

    if (source === "folder") {
      let folder;
      try {
        folder =
          this.handoff?.folder || this.addon().api.folderIntake.sourceDir();
      } catch (e) {
        folder = "";
        this.showError(String(e.message || e));
      }
      this.$("sourceFolder").textContent = folder;
      // The path is ellipsised to share the row with the buttons.
      this.$("sourceFolder").title = folder;
    }

    this.$("sourceHint").textContent =
      source === "folder"
        ? "Reads loose PDFs, identifies each one from the DOI printed inside it, creates or matches the item, then moves the file into your staging folder under a matching name."
        : source === "collection"
          ? "Checks PDFs already filed in one collection: does the DOI inside each file agree with the item it hangs off? Nothing is imported or moved."
          : "Checks every stored PDF in the library: does the DOI inside each file agree with the item it hangs off? Nothing is imported or moved.";

    this.$("summary").textContent =
      source === "folder"
        ? "Press Scan to read the folder."
        : source === "collection"
          ? "Choose a collection, then press Scan."
          : "Press Scan to read every stored PDF.";

    // Zotero names its own attachment files, so that column is only ever
    // filled in for a folder run.
    this.showNameColumn(source === "folder");
    this.setBusy(false);
  },

  /**
   * The cells and the header go, and the <col> collapses to nothing -- left
   * at its natural width it would still claim a share of the table and push
   * everything else into the left of the box.
   */
  showNameColumn(show) {
    this.$("nameHead").hidden = !show;
    this.$("nameCol").classList.toggle("collapsed", !show);
    for (const td of document.querySelectorAll("td.newname")) {
      td.hidden = !show;
    }
  },

  showError(message) {
    const box = this.$("error");
    box.textContent = message;
    box.hidden = !message;
  },

  setBusy(busy) {
    // The one button that is live only while a run is going.
    this.$("stop").disabled = !busy;
    if (!busy) this.$("stop").textContent = "Stop";
    this.$("scan").disabled = busy;
    this.$("chooseSource").disabled = busy;
    this.$("useSettingsSource").disabled =
      busy || (!this.pref("intakeDir") && !this.handoff);
    this.$("dry").disabled = busy || !this.included().length;
    this.$("apply").disabled = busy || !this.included().length;
  },

  included() {
    return this.rows.filter((r) => r.included && r.record);
  },

  /**
   * Ask the run to stop. It finishes the file it is on and then gives back
   * what it has, so nothing is left half written. The button disables itself
   * straight away: asking twice does nothing, and a button that still looks
   * live reads as though the first click missed.
   */
  stop() {
    this.$("stop").disabled = true;
    this.$("stop").textContent = "Stopping\u2026";
    try {
      this.addon().api.cancel.requestStop();
    } catch (e) {
      this.showError(String(e.message || e));
    }
  },

  async scan() {
    this.setBusy(true);
    this.showError("");
    this.$("rows").textContent = "";
    this.$("log").hidden = true;
    try {
      this.rows = await this.api().scan({
        collectionID: this.sourceCollectionID(),
        folder: this.handoff?.folder,
        only: this.handoff?.names,
        onProgress: (done, total, name) => {
          this.$("summary").textContent =
            `Reading ${done} of ${total} — ${name.slice(0, 60)}`;
        },
      });
      this.render();
      if (this.addon().api.cancel.stopRequested()) {
        this.$("summary").textContent +=
          " — stopped, so this is not the whole folder";
      }
    } catch (e) {
      this.showError(String(e.message || e));
      this.$("summary").textContent = "";
    } finally {
      this.setBusy(false);
    }
  },

  render() {
    const counts = {};
    for (const r of this.rows) counts[r.status] = (counts[r.status] || 0) + 1;
    this.$("summary").textContent = this.rows.length
      ? `${this.rows.length} PDFs — ` +
        Object.entries(counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ")
      : this.source() === "folder"
        ? "No PDFs found in that folder."
        : "No stored PDFs found here.";

    this.renderLegend(Object.keys(counts));

    const body = this.$("rows");
    body.textContent = "";
    this.rows.forEach((row, index) => {
      const tr = document.createElement("tr");

      const pick = document.createElement("td");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = row.included;
      box.disabled = !row.record;
      box.addEventListener("change", () => {
        this.rows[index].included = box.checked;
        this.setBusy(false);
      });
      pick.append(box);

      tr.append(
        pick,
        this.cell(
          row.status,
          "status st st-" + row.status.replace(/\s+/g, "-"),
        ),
        this.cell(row.filename, "file"),
        this.cell(
          row.record ? row.record.title : row.reason,
          row.record ? "file" : "note",
        ),
        this.nameCell(row, index),
      );
      tr.title = row.reason;
      body.append(tr);
    });

    this.showNameColumn(this.source() === "folder");
    this.setBusy(false);
  },

  /** Only the statuses actually on screen, so the legend stays short. */
  renderLegend(statuses) {
    const host = this.$("legend");
    host.textContent = "";
    for (const status of statuses) {
      const help = STATUS_HELP[status];
      if (!help) continue;
      const span = document.createElement("span");
      const name = document.createElement("b");
      name.className = "st st-" + status.replace(/\s+/g, "-");
      name.textContent = status;
      span.append(name, document.createTextNode(" " + help));
      host.append(span);
    }
  },

  /* Folder rows get an editable name; a Zotero row is named by Zotero. */
  nameCell(row, index) {
    const td = document.createElement("td");
    td.className = "file newname";
    if (row.source !== "folder") {
      td.className = "note newname";
      td.textContent = "Zotero names it";
      return td;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.value = row.targetName || row.filename;
    input.disabled = !row.record;
    input.addEventListener("change", () => {
      this.rows[index].targetName = input.value.trim() || row.filename;
    });
    td.append(input);
    return td;
  },

  cell(text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  },

  toggleAll(on) {
    for (const row of this.rows) if (row.record) row.included = on;
    this.render();
  },

  async run(dryRun) {
    const targets = this.included();
    if (!targets.length) return;

    this.setBusy(true);
    this.showError("");
    const log = this.$("log");
    log.hidden = false;
    log.textContent = dryRun ? "Dry run...\n" : "Applying...\n";

    try {
      const result = await this.api().apply(this.rows, {
        dryRun,
        collectionID: Picker.collectionID(this.filePicker),
      });
      log.textContent =
        result.log.join("\n") +
        "\n\n" +
        (dryRun
          ? `Dry run — nothing written. ${targets.length} queued.`
          : `created ${result.created}   attached ${result.attached}   ` +
            `renamed ${result.renamed}   filed ${result.filed}   ` +
            `updated ${result.updated}   skipped ${result.skipped}   failed ${result.failed}`) +
        "\n\nDo not rely only on this count — check the library itself.";
      log.scrollTop = log.scrollHeight;
      if (!dryRun) await this.scan();
    } catch (e) {
      this.showError(String(e.message || e));
    } finally {
      this.setBusy(false);
    }
  },
};
