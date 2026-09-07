# Imprint

**A Zotero plugin that identifies papers by the DOI printed inside the PDF.**

- Import a folder of downloads accurately,
- Identify when a paper has been filed under the wrong item, and
- Report the gaps between what's filed on your computer and what your library thinks it has.

For Zotero 9 and 10.
[Download the latest release](https://github.com/KateW11/zotero-imprint/releases).

![Reconciling a folder of PDFs against one collection](docs/ReconcileCollection.png)

---

## What it does

### Import a folder of downloads in one pass

_The problem: a folder of PDFs named `fpsyg-09-00282.pdf` and
`1-s2.0-S0010027718300398-main.pdf`._

Imprint reads the DOI out of each file, looks it up,
and reports a table of findings. You tick the rows you want, pick a collection, and Imprint will:

- create the items,
- attach the files,
- renames them to Zotero's convention
- moves the originals into your archive folder.

Unidentifiable items are listed, with the reason.

### Check what Zotero has already filed

_The problem: a paper filed under the wrong item looks completely normal in
Zotero._

Imprint compares every stored PDF against the DOI printed inside it and tells
you which ones agree, which ones disagree, and which ones carry no DOI it can
check.

**Nothing else will find these, because there is nothing visibly wrong with
them.**

Imprint can:

- fill in the blanks,
- only ever add, never overwriting something you already entered,
- check the whole library, or just one collection and its subcollections.

![Intake reporting on every PDF already in the library](docs/IntakeScan.png)

### Export your annotations in bulk

_The problem: Zotero keeps your highlights in its database, not in the file.
Back up your storage folder and you have backed up the papers and none of the
reading._

Imprint writes them out, for the whole library or one collection:

- **Annotated PDFs** — copies with the annotations embedded as standard PDF
  annotations, which open in Preview, Acrobat or a tablet.
- **Lists of annotations** — every highlight and note as a document, one per
  paper, in **Markdown, plain text, CSV or HTML**. Each entry carries its page,
  highlight colour and tags, and links straight back to the annotation in
  Zotero. Drop them into Obsidian, a draft, or a spreadsheet.
- **Or both**, side by side.

It tracks which files are out of date against the newest annotation on each
paper, so a second run writes only what you have read since.

![Exporting annotations out of the library](docs/ExportAnnotations.png)

### Reconcile your folder against your library

_The problem: four questions that nothing answers together._

|                                                   |                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **In the folder, not in the library at all**      | a paper you hold that Zotero has never been told about                                                        |
| **In the library, no copy in the folder**         | an item with no local backup outside Zotero                                                                   |
| **Attachment rows whose file is missing on disk** | it looks present in Zotero, opens to nothing, and will never appear on a phone. Zotero has no report of these |
| **Items with no PDF attached**                    | nothing to read on any device                                                                                 |

- Compare against the whole library or a single collection.
- Scoped to a collection, files that _are_ in your library but filed elsewhere
  are listed apart from the papers Zotero has genuinely never seen.

---

## Why not just use Zotero's own PDF metadata retrieval?

Zotero identifies a dragged PDF on import, and it is usually right. Nothing
tells you when it is wrong.

Imprint is stricter about what counts as evidence. It reads the DOI from inside
the file and resolves it at Crossref before accepting it. Where no DOI can be
read, it falls back to a bibliographic search under a real test — a title
similarity floor, a type that is actually an article, and a filename that
agrees on the year or an author. A candidate that fails is reported, not
accepted.

Four traps it was built to avoid, every one of them found in a real library:

- **Journal-level DOIs.** Wiley and others stamp the _journal's_ DOI in the PDF
  metadata. `10.1111/(ISSN)2044-8295` is _British Journal of Psychology_, not
  the paper in your hand. Accepting one files the wrong work and looks
  confident doing it.
- **Circular confirmation.** A file Zotero named from an item cannot be used to
  confirm that item. Only a DOI read from inside the file counts.
- **A cited DOI, not the claimed one.** An abstract discussing another paper
  carries that paper's DOI too. Take whichever the extractor emits first and
  you file the paper under the work it cites.
- **A work about the work.** A review quotes the title of what it reviews, so
  it scores against a filename as well as the real thing does.

And two things Zotero has no equivalent for at all: bulk export of your
annotations, and a report of attachment rows whose file is missing from disk.

---

## Guides

- [Your first import](docs/first-import.md) — install, settings, and a folder
  of downloads into Zotero, start to finish
- [Auditing a library you already have](docs/auditing-a-library.md) — finding
  papers filed under the wrong item
- [When it can't identify something](docs/when-it-cannot-identify.md) — what
  "needs you" and "cannot verify" mean, and what to do about each

## Install

1. Download `imprint.xpi` from the
   [releases page](https://github.com/KateW11/zotero-imprint/releases)
2. In Zotero: **Tools → Plugins**
3. Click the gear icon, then **Install Add-on From File…**
4. Choose the downloaded `.xpi`
5. Restart Zotero

Everything lives under **Tools → Imprint**.

## Settings

**Zotero → Settings → Imprint**

|                            |                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| New PDFs are dropped in    | the folder Imprint imports from                                                                                 |
| Renamed PDFs are filed to  | where identified files are moved, and what reconcile compares against                                           |
| Exported annotations go to | where annotated PDFs and annotation lists are written. Blank means an `Annotated` subfolder of the folder above |
| Email for Crossref         | optional; Crossref gives faster service to requests that identify themselves                                    |

Each tool window can also point at a different folder for one run — **Choose…**
next to the folder it works on, and **Use settings folder** to go back. That
choice is remembered per window and never changes the settings above.

Caches live in an `imprint` folder inside your Zotero data directory. Delete
them any time — they exist only so a second run costs nothing.

## What it does not do

- It relies on Crossref, so it identifies what Crossref indexes. Books are
  indexed poorly and are deliberately not accepted on a title match alone.
- It reads text, so a scanned PDF with no text layer has no DOI to find. Those
  fall back to the filename search, and are reported when that fails too.
- It reaches Zotero's PDF engine through internal methods in order to read a
  file that is not in the library yet. These are checked for at runtime and
  there is a slower fallback, but a future Zotero release could change them.

## Development

Node LTS, then `npm install`. Commands, the `.env` a development profile needs,
and the test suite are in [Development](docs/development.md).

The suite is 161 cases across 13 files. Almost none of it was written from the
code — it is what a real library of 150 papers made this plugin get wrong,
written down so it cannot come back.

## Licence

AGPL-3.0-or-later. The project structure derives from
[zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
by windingwind, which is AGPL.

Named for the publisher's mark inside a book, because that is what it reads.
