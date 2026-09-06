/* View layer for the annotated-PDF mirror. All the real work lives in the
 * plugin's mirror module, reached through Zotero.__addonInstance__.api. */

var Zotero =
  window.opener?.Zotero ||
  Components.classes["@zotero.org/Zotero;1"].getService(
    Components.interfaces.nsISupports,
  ).wrappedJSObject;

var MirrorWindow = {
  records: [],

  api() {
    const addon = Zotero.__addonInstance__;
    if (!addon?.data?.alive) {
      throw new Error(
        "The plugin was reloaded. Close this window and open it again.",
      );
    }
    return addon.api.mirror;
  },

  async init() {
    await this.rescan();
  },

  teardown() {
    this.records = [];
  },

  $(id) {
    return document.getElementById(id);
  },

  showError(message) {
    const box = this.$("error");
    box.textContent = message;
    box.hidden = !message;
  },

  setBusy(busy) {
    for (const id of ["rescan", "dry", "stale", "all"]) {
      this.$(id).disabled = busy;
    }
  },

  async rescan() {
    this.setBusy(true);
    this.showError("");
    try {
      this.$("dir").textContent = this.api().mirrorDir();
      this.records = await this.api().scan();
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
      : "No annotated PDFs found in this library.";

    const body = this.$("rows");
    body.textContent = "";
    for (const r of this.records) {
      const tr = document.createElement("tr");
      tr.append(
        this.cell(r.status, `status st st-${r.status.replace(/\s+/g, "-")}`),
        this.cell(r.name, "file"),
        this.cell(String(r.annotations), "num"),
      );
      tr.title = r.path;
      body.append(tr);
    }

    this.$("stale").disabled = this.staleRecords().length === 0;
    this.$("all").disabled = this.records.length === 0;
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
      const result = await this.api().exportRecords(targets, { dryRun });
      log.textContent =
        result.log.join("\n") +
        "\n\n" +
        (dryRun
          ? `Dry run — nothing written. ${targets.length} queued.`
          : `files: ${result.written}   annotations embedded: ${result.annotations}   failed: ${result.failed}   of ${targets.length} queued`) +
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
