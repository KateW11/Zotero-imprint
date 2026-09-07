import { cleanField } from "../utils/naming";

/**
 * Annotations as a readable list, rather than embedded in a PDF.
 *
 * The same data the annotated export writes into the file, written out as
 * text instead: one file per paper, beside its PDF.
 */

export type ListFormat = "markdown" | "text" | "csv" | "html";

/** Zotero's own highlight palette. A hex code in your notes tells you nothing. */
const COLOUR_NAMES: Record<string, string> = {
  "#ffd400": "yellow",
  "#ff6666": "red",
  "#5fb236": "green",
  "#2ea8e5": "blue",
  "#a28ae5": "purple",
  "#e56eee": "magenta",
  "#f19837": "orange",
  "#aaaaaa": "gray",
};

function colourName(hex: string): string {
  return COLOUR_NAMES[String(hex || "").toLowerCase()] || String(hex || "");
}

export interface AnnotationEntry {
  key: string;
  type: string;
  text: string;
  comment: string;
  colour: string;
  page: string;
  tags: string[];
  /** Opens the reader at this annotation. Only works for someone who has the item. */
  link: string;
}

export function extensionFor(format: ListFormat): string {
  return format === "markdown" ? "md" : format === "text" ? "txt" : format;
}

/** Annotations on an attachment, in the order they appear in the document. */
export function collect(attachment: Zotero.Item): AnnotationEntry[] {
  const annotations = attachment.getAnnotations();
  annotations.sort((a, b) =>
    String(a.annotationSortIndex || "").localeCompare(
      String(b.annotationSortIndex || ""),
    ),
  );

  return annotations.map((a) => ({
    key: a.key,
    type: String(a.annotationType || ""),
    text: cleanField(a.annotationText || ""),
    comment: cleanField(a.annotationComment || ""),
    colour: colourName(a.annotationColor || ""),
    page: String(a.annotationPageLabel || ""),
    tags: a.getTags().map((t) => t.tag),
    link: `zotero://open-pdf/library/items/${attachment.key}?annotation=${a.key}`,
  }));
}

/** The bits before the quote: page, colour, tags. Any of them may be absent. */
function metaParts(entry: AnnotationEntry): string[] {
  const parts: string[] = [];
  if (entry.page) parts.push(`p. ${entry.page}`);
  if (entry.colour) parts.push(entry.colour);
  if (entry.tags.length) parts.push(entry.tags.map((t) => `#${t}`).join(" "));
  return parts;
}

function markdown(title: string, entries: AnnotationEntry[]): string {
  const out = [`# ${title}`, "", `${entries.length} annotations`, ""];
  for (const e of entries) {
    out.push("---", "");
    const meta = metaParts(e);
    if (meta.length) out.push(`**${meta.join("** · **")}**`, "");
    // A blockquote per line, so a highlight spanning lines stays one quote.
    if (e.text) out.push(...e.text.split("\n").map((l) => `> ${l}`), "");
    if (e.comment) out.push(e.comment, "");
    out.push(`[Open in Zotero](${e.link})`, "");
  }
  return out.join("\n");
}

function plainText(title: string, entries: AnnotationEntry[]): string {
  const out = [
    title,
    "=".repeat(title.length),
    "",
    `${entries.length} annotations`,
    "",
  ];
  for (const e of entries) {
    const meta = metaParts(e);
    out.push(meta.length ? `[${meta.join(" · ")}]` : "[annotation]");
    if (e.text) out.push(`  "${e.text}"`);
    if (e.comment) out.push(`  -- ${e.comment}`);
    out.push(`  ${e.link}`, "");
  }
  return out.join("\n");
}

function csvCell(value: string): string {
  let text = String(value ?? "");
  // A highlight that begins with =, +, - or @ is a formula to Excel and to
  // Sheets, which will evaluate it -- including forms that fetch a URL. A
  // leading apostrophe is the spreadsheet convention for "this is text"; it
  // is the standard mitigation and it survives a round trip through the
  // application.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  // Doubling the quotes is the escape; the quotes around it make commas and
  // newlines in a highlight safe.
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(title: string, entries: AnnotationEntry[]): string {
  const rows = [
    ["paper", "page", "colour", "tags", "type", "text", "comment", "link"]
      .map(csvCell)
      .join(","),
  ];
  for (const e of entries) {
    rows.push(
      [
        title,
        e.page,
        e.colour,
        e.tags.join(" "),
        e.type,
        e.text,
        e.comment,
        e.link,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return rows.join("\n");
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function html(title: string, entries: AnnotationEntry[]): string {
  const body = entries
    .map((e) => {
      const meta = metaParts(e).map(escapeHtml).join(" &middot; ");
      return [
        "  <li>",
        meta ? `    <p class="meta">${meta}</p>` : "",
        e.text ? `    <blockquote>${escapeHtml(e.text)}</blockquote>` : "",
        e.comment ? `    <p class="comment">${escapeHtml(e.comment)}</p>` : "",
        `    <p><a href="${escapeHtml(e.link)}">Open in Zotero</a></p>`,
        "  </li>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 42em; margin: 2em auto; padding: 0 1em; }
  li { list-style: none; border-top: 1px solid #ddd; padding: 1em 0; }
  ul { padding: 0; }
  .meta { color: #666; font-size: .85em; margin: 0 0 .5em; }
  blockquote { margin: 0 0 .5em; padding-left: 1em; border-left: 3px solid #ccc; }
  .comment { margin: 0 0 .5em; }
  a { font-size: .85em; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${entries.length} annotations</p>
<ul>
${body}
</ul>
</body>
</html>
`;
}

export function render(
  title: string,
  entries: AnnotationEntry[],
  format: ListFormat,
): string {
  switch (format) {
    case "text":
      return plainText(title, entries);
    case "csv":
      return csv(title, entries);
    case "html":
      return html(title, entries);
    default:
      return markdown(title, entries);
  }
}
