# Auditing a library you already have

Zotero identifies PDFs when you drag them in, and it is usually right. Nothing
tells you about the times it wasn't.

A paper filed under the wrong item looks completely normal: the item has a
title, a year, authors and a PDF. You only find out when you open it, or worse,
when you cite it.

Imprint compares every stored PDF against the DOI printed inside the file. That
is the only evidence that settles the question.

## Running it

1. Click **Tools**, then **Imprint**, then **Intake…**
2. Leave **Source** on **PDFs already in Zotero**
3. Click **Scan**

For a library of a hundred and fifty papers this takes under a minute. Nothing
is written.

To check one collection instead — a reading list, a chapter's sources — choose
**PDFs in a collection** and pick it. Subcollections are included.

![Intake reporting on every PDF already in the library](IntakeScan.png)

## What each status means

**checks out** — the DOI inside the file matches the item it is filed under.
Nothing to do.

**disagrees with the file** — the file is a different paper from the item. This
is the one to look at. Open the attachment and see which is right: sometimes
the file is wrong, sometimes the item's DOI was mistyped or auto-filled badly.

**item has no DOI** — the item carries no DOI, and the file's resolves cleanly.
Ticking these and clicking **Apply** fills in the DOI and any other fields the
item is missing. It only ever adds — nothing you typed is overwritten.

**cannot verify** — no DOI could be read from the file, or the one in it isn't
one Crossref recognises. Not a problem, just not something the plugin can
confirm either way. Common causes are in
[When it can't identify something](when-it-cannot-identify.md).

**already has PDF** — a second copy of a paper you already hold with a file.

## What to do about a disagreement

Work out which side is wrong before changing anything.

1. Click the item in Zotero and open its PDF
2. Compare it against the item's title and DOI
3. If the **file** is wrong — it was attached to the wrong item — move it to
   the right item, or delete it and re-import from your archive folder
4. If the **item** is wrong — bad metadata attached to the right paper — fix
   the item's DOI, then re-run the scan and it should read "checks out"

Imprint deliberately will not act on a disagreement for you. Deciding which of
two plausible records is correct is a judgement about your library, not
something to resolve from a DOI string.

## What this won't catch

An item with no PDF at all — there is nothing to check it against. Those show
up in the reconcile report instead, under **Items with no PDF attached**.

A paper whose PDF genuinely has no DOI printed in it. Older scans especially.
Those come back as "cannot verify", which means unchecked, not correct.
