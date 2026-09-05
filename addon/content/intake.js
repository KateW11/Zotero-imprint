/* View layer for intake. The work is in the plugin's intake module, reached
 * through Zotero.__addonInstance__.api. */

var Zotero =
  window.opener?.Zotero ||
  Components.classes["@zotero.org/Zotero;1"].getService(
    Components.interfaces.nsISupports,
  ).wrappedJSObject;

var IntakeWindow = {
  rows: [],

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
    const picked = document.querySelector('input[name="sourceCollection"]:checked');
    return picked && picked.value ? Number(picked.value) : null;
  },

  sourceChanged() {
    this.rows = [];
    this.$("rows").textContent = "";
    this.$("log").hidden = true;
    this.showError("");
    const source = this.source();
    this.$("sourceCollectionBar").hidden = source !== "collection";
    this.$("summary").textContent =
      source === "folder"
        ? "Press Scan to read the source folder."
        : source === "collection"
          ? "Choose a collection, then press Scan."
          : "Press Scan to read every stored PDF.";
    this.setBusy(false);
  },

  $(id) {
    return document.getElementById(id);
  },

  init() {
    const add = (host, group, value, text, checked) => {
      const label = document.createElement("label");
      label.className = "choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = group;
      input.value = value;
      if (checked) input.checked = true;
      label.append(input, document.createTextNode(text));
      host.append(label);
    };

    const collections = this.addon().api.intake.collections();

    const fileInto = this.$("collections");
    add(fileInto, "collection", "", "(no collection)", true);
    for (const c of collections) add(fileInto, "collection", String(c.id), c.path, false);

    const readFrom = this.$("sourceCollections");
    if (collections.length) {
      collections.forEach((c, i) =>
        add(readFrom, "sourceCollection", String(c.id), c.path, i === 0),
      );
    } else {
      // An empty row reads as a broken control rather than as an empty library.
      const empty = document.createElement("span");
      empty.className = "note";
      empty.textContent = "This library has no collections.";
      readFrom.append(empty);
    }
    this.setBusy(false);
    this.$("summary").textContent = "Press Scan to read every stored PDF.";
  },

  showError(message) {
    const box = this.$("error");
    box.textContent = message;
    box.hidden = !message;
  },

  setBusy(busy) {
    this.$("scan").disabled = busy;
    this.$("dry").disabled = busy || !this.included().length;
    this.$("apply").disabled = busy || !this.included().length;
  },

  included() {
    return this.rows.filter((r) => r.included && r.record);
  },

  async scan() {
    this.setBusy(true);
    this.showError("");
    this.$("rows").textContent = "";
    this.$("log").hidden = true;
    try {
      this.rows = await this.api().scan({
        collectionID: this.sourceCollectionID(),
        onProgress: (done, total, name) => {
          this.$("summary").textContent =
            `Reading ${done} of ${total} — ${name.slice(0, 60)}`;
        },
      });
      this.render();
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
    this.$("summary").textContent =
      this.rows.length
        ? `${this.rows.length} PDFs — ` +
          Object.entries(counts)
            .map(([k, v]) => `${v} ${k}`)
            .join(", ")
        : "No stored PDFs found in this library.";

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
        this.cell(row.status, "st st-" + row.status.replace(/\s+/g, "-")),
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
    this.setBusy(false);
  },

  /* Folder rows get an editable name; a Zotero row is named by Zotero. */
  nameCell(row, index) {
    const td = document.createElement("td");
    td.className = "file";
    if (row.source !== "folder") {
      td.className = "note";
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

    const picked = document.querySelector('input[name="collection"]:checked');
    const value = picked ? picked.value : "";
    try {
      const result = await this.api().apply(this.rows, {
        dryRun,
        collectionID: value ? Number(value) : null,
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
