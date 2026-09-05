/* View layer for reconcile. The work is in the plugin's reconcile module,
 * reached through Zotero.__addonInstance__.api. */

var Zotero =
  window.opener?.Zotero ||
  Components.classes["@zotero.org/Zotero;1"].getService(
    Components.interfaces.nsISupports,
  ).wrappedJSObject;

var ReconcileWindow = {
  report: null,

  api() {
    const addon = Zotero.__addonInstance__;
    if (!addon?.data?.alive) {
      throw new Error(
        "The plugin was reloaded. Close this window and open it again.",
      );
    }
    return addon.api;
  },

  scope() {
    const picked = document.querySelector('input[name="scope"]:checked');
    return picked ? picked.value : "library";
  },

  scopeCollectionID() {
    if (this.scope() !== "collection") return null;
    const picked = document.querySelector('input[name="scopeCollection"]:checked');
    return picked && picked.value ? Number(picked.value) : null;
  },

  scopeChanged() {
    this.$("scopeCollectionBar").hidden = this.scope() !== "collection";
  },

  $(id) {
    return document.getElementById(id);
  },

  folder() {
    return (Zotero.Prefs.get("extensions.zotero.imprint.stagingDir", true) || "").trim();
  },

  init() {
    const host = this.$("scopeCollections");
    const collections = this.api().intake.collections();
    if (collections.length) {
      collections.forEach((c, i) => {
        const label = document.createElement("label");
        label.className = "choice";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "scopeCollection";
        input.value = String(c.id);
        if (i === 0) input.checked = true;
        label.append(input, document.createTextNode(c.path));
        host.append(label);
      });
    } else {
      const empty = document.createElement("span");
      empty.className = "note";
      empty.textContent = "This library has no collections.";
      host.append(empty);
    }

    const dir = this.folder();
    this.$("dir").textContent = dir || "(no staging folder set in settings)";
    this.$("run").disabled = !dir;
    if (!dir) {
      this.showError(
        "Set the staging folder in Zotero Settings, under Imprint, then reopen this window.",
      );
    }
  },

  showError(message) {
    const box = this.$("error");
    box.textContent = message;
    box.hidden = !message;
  },

  setBusy(busy) {
    this.$("run").disabled = busy || !this.folder();
    this.$("copy").disabled = busy || !this.report;
    this.$("rescanAll").disabled = busy;
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
      this.showError(String(e.message || e));
      this.$("summary").textContent = "";
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
      warn.textContent =
        `Storage folder not found at ${r.storage}, so attachment files were not checked.`;
      host.append(warn);
    }

    // Scoped to a collection, "no item here" is mostly files that are simply
    // filed elsewhere. Separating them keeps the papers the library has never
    // seen from being buried under them.
    const unknown = r.folderOnly.filter((x) => !x.elsewhere);
    const elsewhere = r.folderOnly.filter((x) => x.elsewhere);
    const withDoi = (x) => x.name + (x.doi ? "  —  " + x.doi : "");

    this.section(host, "In the folder, not in the library at all", unknown, withDoi);
    if (elsewhere.length) {
      this.section(host, `In the folder and in the library, but not in ${r.scope}`,
        elsewhere, withDoi, null, (x) => x.elsewhere);
    }

    this.section(host, `In ${r.scope}, no copy in the folder`, r.libraryOnly,
      (x) => x.title, (x) => x.key,
      (x) => (x.hasPdf ? "" : "no PDF in Zotero either"));

    this.section(host, "Attachment rows whose file is missing on disk", r.broken,
      (x) => x.title, (x) => x.key, (x) => x.filename);

    this.section(host, `Items in ${r.scope} with no PDF attached`, r.noPdf,
      (x) => x.title, (x) => x.key);
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

  copyMarkdown() {
    if (!this.report) return;
    const md = this.api().reconcile.asMarkdown(this.report, this.folder());
    Zotero.Utilities.Internal.copyTextToClipboard(md);
    this.$("summary").textContent += "   — report copied to the clipboard";
  },
};
