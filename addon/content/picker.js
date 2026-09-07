/* A dropdown built out of ordinary elements.
 *
 * These windows cannot use <select>. They are chrome windows, and a chrome
 * window has no working popup layer for one: the options paint as loose
 * overlapping text across whatever is behind them. That was true when they
 * were XUL windows and it is still true now they are plain HTML, so this
 * draws its own panel inside the document and never asks for a popup.
 *
 * Radio buttons were the workaround before. They are unusable past a dozen
 * collections and unreadable past a hundred, which is what this replaces.
 */

var Picker = {
  /** Show the filter box only when the list is long enough to need it. */
  FILTER_FROM: 8,

  /**
   * Fill `host` with a dropdown. Returns the element, which fires "change"
   * when the selection changes, or null when there is nothing to choose.
   *
   * options.entries   [{ value, label }], in the order to show them
   * options.selected  value to start on; defaults to the first entry
   * options.empty     what to say when there are no entries at all
   */
  install(host, options) {
    const doc = host.ownerDocument;
    const entries = options.entries || [];
    host.textContent = "";

    if (!entries.length) {
      // An empty control reads as broken; a sentence reads as an empty library.
      const note = doc.createElement("span");
      note.className = "note";
      note.textContent = options.empty || "Nothing to choose from.";
      host.append(note);
      return null;
    }

    const el = (tag, className) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      return node;
    };

    const combo = el("div", "combo");
    const button = el("button", "comboButton");
    button.type = "button";
    const text = el("span", "comboText");
    const caret = el("span", "comboCaret");
    caret.textContent = "▾";
    button.append(text, caret);

    const panel = el("div", "comboPanel");
    panel.hidden = true;
    const filter = el("input", "filter");
    filter.type = "text";
    filter.placeholder = "Filter";
    filter.hidden = entries.length < this.FILTER_FROM;
    const list = el("div", "comboList");
    panel.append(filter, list);

    combo.append(button, panel);
    host.append(combo);

    /** Entries currently passing the filter, and which of them is highlighted. */
    let shown = entries;
    let active = 0;

    const setValue = (value) => {
      const entry = entries.find((e) => e.value === value) || entries[0];
      combo.dataset.value = entry.value;
      text.textContent = entry.label;
      button.title = entry.label;
    };

    const draw = () => {
      const terms = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
      shown = entries.filter((e) =>
        terms.every((t) => e.label.toLowerCase().includes(t)),
      );
      list.textContent = "";

      if (!shown.length) {
        const none = el("div", "comboEmpty");
        none.textContent = "Nothing matches that";
        list.append(none);
        return;
      }

      const chosen = shown.findIndex((e) => e.value === combo.dataset.value);
      active = chosen >= 0 ? chosen : 0;

      shown.forEach((entry, i) => {
        const row = el("div", "comboItem");
        row.textContent = entry.label;
        row.title = entry.label;
        if (entry.value === combo.dataset.value) row.classList.add("chosen");
        if (i === active) row.classList.add("active");
        // mousedown, not click: the panel closes on any mousedown outside it,
        // and a click would arrive after that had already torn the row down.
        row.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          choose(entry.value);
        });
        list.append(row);
      });
      scrollActiveIntoView();
    };

    const highlight = (i) => {
      if (!shown.length) return;
      active = Math.max(0, Math.min(shown.length - 1, i));
      const rows = list.querySelectorAll(".comboItem");
      rows.forEach((row, n) => row.classList.toggle("active", n === active));
      scrollActiveIntoView();
    };

    const scrollActiveIntoView = () => {
      list.querySelectorAll(".comboItem")[active]?.scrollIntoView({
        block: "nearest",
      });
    };

    const choose = (value) => {
      const before = combo.dataset.value;
      setValue(value);
      close();
      button.focus();
      if (value !== before) {
        combo.dispatchEvent(new doc.defaultView.CustomEvent("change"));
      }
    };

    const outside = (ev) => {
      if (!combo.contains(ev.target)) close();
    };

    const onKey = (ev) => {
      switch (ev.key) {
        case "Escape":
          ev.preventDefault();
          close();
          button.focus();
          break;
        case "ArrowDown":
          ev.preventDefault();
          highlight(active + 1);
          break;
        case "ArrowUp":
          ev.preventDefault();
          highlight(active - 1);
          break;
        case "Enter":
          ev.preventDefault();
          if (shown[active]) choose(shown[active].value);
          break;
        default:
      }
    };

    const open = () => {
      filter.value = "";
      draw();
      panel.hidden = false;
      if (!filter.hidden) filter.focus();
      // Capture, so a click anywhere -- including on another control -- shuts
      // the panel before that control acts on it.
      doc.addEventListener("mousedown", outside, true);
      doc.addEventListener("keydown", onKey, true);
    };

    const close = () => {
      panel.hidden = true;
      doc.removeEventListener("mousedown", outside, true);
      doc.removeEventListener("keydown", onKey, true);
    };

    button.addEventListener("click", () => {
      if (panel.hidden) open();
      else close();
    });
    filter.addEventListener("input", draw);

    setValue(options.selected ?? entries[0].value);
    return combo;
  },

  /** The chosen value, as a string. "" when nothing is chosen. */
  value(combo) {
    return combo ? combo.dataset.value || "" : "";
  },

  /** Collections in the shape install() wants. */
  collectionEntries(collections, noneLabel) {
    const entries = noneLabel ? [{ value: "", label: noneLabel }] : [];
    for (const c of collections) {
      entries.push({ value: String(c.id), label: c.path });
    }
    return entries;
  },

  /** The chosen collection ID, or null. */
  collectionID(combo) {
    const v = this.value(combo);
    return v ? Number(v) : null;
  },
};
