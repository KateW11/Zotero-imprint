/* View layer for the annotation export. All the real work lives in the
 * plugin's annotations module, reached through Zotero.__addonInstance__.api. */

var Zotero =
  window.opener?.Zotero ||
  Components.classes["@zotero.org/Zotero;1"].getService(
    Components.interfaces.nsISupports,
  ).wrappedJSObject;

var AnnotationsWindow = {
  records: [],
  scopePicker: null,
  formatPicker: null,

  /** The list formats offered, and what each writes. */
  FORMATS: [
    { value: "markdown", label: "Markdown (.md)" },
    { value: "text", label: "Plain text (.txt)" },
    { value: "csv", label: "Spreadsheet (.csv)" },
    { value: "html", label: "Web page (.html)" },
  ],

  api() {
    const addon = Zotero.__addonInstance__;
    if (!addon?.data?.alive) {
      throw new Error(
        "The plugin was reloaded. Close this window and open it again.",
      );
    }
    return addon.api;
  },

  async init() {
    try {
      this.formatPicker = Picker.install(this.$("format"), {
        entries: this.FORMATS,
      });
      this.formatPicker?.addEventListener("change", () => this.choiceChanged());

      this.scopePicker = Picker.install(this.$("scopeCollection"), {
        entries: Picker.collectionEntries(this.api().intake.collections()),
        empty: "This library has no collections.",
      });
      this.scopePicker?.addEventListener("change", () => this.rescan());

      this.choiceChanged();
    } catch (e) {
      this.showError(String(e.message || e));
      return;
    }
    await this.rescan();
  },

  teardown() {
    this.records = [];
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
   * Pick another folder for this run. Its own preference, so exporting
   * somewhere else once does not move the export folder in settings.
   */
  async chooseFolder() {
    const picked = await this.api().folders.pickFolder(
      "Folder to write annotations to",
    );
    if (!picked) return;
    this.setPref("annotationsDir", picked);
    await this.rescan();
  },

  useSettingsFolder() {
    this.setPref("annotationsDir", "");
    this.rescan();
  },

  what() {
    const picked = document.querySelector('input[name="what"]:checked');
    return picked ? picked.value : "pdf";
  },

  format() {
    return Picker.value(this.formatPicker) || "markdown";
  },

  scope() {
    const picked = document.querySelector('input[name="scope"]:checked');
    return picked ? picked.value : "library";
  },

  collectionID() {
    if (this.scope() !== "collection") return null;
    return Picker.collectionID(this.scopePicker);
  },

  options() {
    return {
      what: this.what(),
      format: this.format(),
      collectionID: this.collectionID(),
    };
  },

  /* The chosen output decides which files are looked for on disk, so the
   * table has to be read again rather than merely relabelled. */
  choiceChanged() {
    const what = this.what();
    const listing = what !== "pdf";
    this.$("format").hidden = !listing;
    this.$("formatLabel").hidden = !listing;
    this.$("whatHint").textContent =
      what === "pdf"
        ? "A copy of each PDF with your highlights and notes drawn into the file, so any PDF reader shows them."
        : what === "list"
          ? "Your highlights and notes as a document, one per paper, each entry linking back to the page in Zotero."
          : "Both files for each paper: the annotated PDF, and the highlights and notes as a separate document.";
    if (this.records.length) this.rescan();
  },

  scopeChanged() {
    this.$("scopeCollection").hidden = this.scope() !== "collection";
    this.rescan();
  },

  showError(message) {
    const box = this.$("error");
    box.textContent = message;
    box.hidden = !message;
  },

  setBusy(busy) {
    this.$("stop").disabled = !busy;
    if (!busy) this.$("stop").textContent = "Stop";
    for (const id of ["rescan", "choose", "dry", "stale", "all"]) {
      this.$(id).disabled = busy;
    }
    this.$("useSettings").disabled = busy || !this.pref("annotationsDir");
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

  async rescan() {
    this.setBusy(true);
    this.showError("");
    try {
      const dir = this.api().annotations.exportDir();
      this.$("dir").textContent = dir;
      // The path is ellipsised to share the row with the buttons.
      this.$("dir").title = dir;
      this.records = await this.api().annotations.scan(this.options());
      this.render();
    } catch (e) {
      this.records = [];
      this.render();
      this.showError(String(e.message || e));
    } finally {
      this.setBusy(false);
    }
  },

  staleRecords() {
    return this.records.filter((r) => r.status !== "current");
  },

  render() {
    const counts = { "not written": 0, "out of date": 0, current: 0 };
    for (const r of this.records) counts[r.status] += 1;

    this.$("summary").textContent = this.records.length
      ? `${this.records.length} annotated ${
          this.records.length === 1 ? "attachment" : "attachments"
        } — ` +
        `${counts["not written"]} not written, ` +
        `${counts["out of date"]} out of date, ` +
        `${counts.current} current`
      : this.scope() === "collection"
        ? "No annotated PDFs in that collection."
        : "No annotated PDFs found in this library.";

    const listing = this.what() !== "pdf";
    const body = this.$("rows");
    body.textContent = "";
    for (const r of this.records) {
      const tr = document.createElement("tr");
      tr.append(
        this.cell(r.status, `status st st-${r.status.replace(/\s+/g, "-")}`),
        this.cell(this.what() === "list" ? this.listName(r) : r.name, "file"),
        this.cell(String(r.annotations), "num"),
      );
      tr.title = listing ? `${r.pdfPath}\n${r.listPath}` : r.pdfPath;
      body.append(tr);
    }

    this.$("stale").disabled = this.staleRecords().length === 0;
    this.$("all").disabled = this.records.length === 0;
  },

  listName(record) {
    return record.listPath.split("/").pop();
  },

  cell(text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  },

  async run({ dryRun, staleOnly }) {
    const targets = staleOnly ? this.staleRecords() : this.records;
    if (!targets.length) return;

    this.setBusy(true);
    this.showError("");
    const log = this.$("log");
    log.hidden = false;
    log.textContent = dryRun ? "Dry run...\n" : "Exporting...\n";

    try {
      const result = await this.api().annotations.exportRecords(targets, {
        ...this.options(),
        dryRun,
      });
      log.textContent =
        result.log.join("\n") +
        "\n\n" +
        (dryRun
          ? `Dry run — nothing written. ${targets.length} queued.`
          : `files: ${result.written}   annotations: ${result.annotations}   failed: ${result.failed}   of ${targets.length} papers queued`) +
        "\n\nDo not rely only on this count — check the folder itself.";
      log.scrollTop = log.scrollHeight;
      if (!dryRun) await this.rescan();
    } catch (e) {
      this.showError(String(e.message || e));
    } finally {
      this.setBusy(false);
    }
  },
};
