# When it can't identify something

Imprint would rather tell you it doesn't know than guess. This is what sits
behind "needs you" and "cannot verify", and what to do about each.

## No DOI printed in the file

Common for anything published before about 2000, for book chapters, and for
scans. Imprint falls back to searching Crossref for the filename, under a real
test — the title has to be similar enough, the year has to agree, and the
result has to be an article rather than a book or a dataset. If nothing passes,
you get "needs you".

**What to do:** find the DOI yourself and add it to the item, then rescan. Or
if it has no DOI at all, accept the row as unverifiable and move on — plenty of
good papers have none.

## The DOI is there but doesn't resolve

Usually a DOI printed across a line break. Text extraction either drops the
hyphen or truncates the DOI at it, and what comes out doesn't exist. Imprint
checks every DOI against Crossref before accepting it, so a mangled one is
rejected rather than used.

**What to do:** nothing, usually. The filename search normally catches these.
If it doesn't, copy the DOI off the paper's first page by hand.

## The file is supplementary material

APA and others mint a separate DOI for a paper's supplement, and the
supplement's PDF carries it. Imprint reports these as "cannot verify" rather
than as a disagreement, because the file is that paper's appendix, not a
different work.

**What to do:** nothing. It is filed correctly.

## The metadata holds the journal's DOI, not the paper's

Wiley and some others stamp the journal's DOI into the PDF's metadata.
`10.1111/(ISSN)2044-8295` is *British Journal of Psychology* — not any
particular paper in it. Imprint rejects these outright, because accepting one
files the wrong work while looking completely confident.

**What to do:** nothing. It falls through to reading the page text, which
carries the article's real DOI.

## It's a book

Crossref indexes books poorly, and a book's title routinely matches a later
paper *about* that book with a high relevance score. Imprint will not accept a
book on a title match alone, which means books mostly come back as "needs you".

**What to do:** add books by hand, or with Zotero's ISBN lookup — click the
green **Add Item by Identifier** button in the toolbar and paste the ISBN.

## The PDF is a scan with no text layer

There is no text to read a DOI from, so extraction finds nothing and the
filename search is all that is left.

**What to do:** run OCR on it — the
[Zotero OCR plugin](https://github.com/UB-Mannheim/zotero-ocr) does this inside
Zotero — then rescan.

## Crossref is unreachable

Everything comes back unidentified at once, rather than a few rows failing.

**What to do:** wait and rescan. Answers are cached, so a rerun only asks about
the files that failed. Adding your email under **Zotero → Settings → Imprint**
gets you Crossref's faster service and makes throttling less likely.

## Still stuck?

Open an issue at
[github.com/KateW11/zotero-imprint/issues](https://github.com/KateW11/zotero-imprint/issues)
with the filename, the status shown, and the reason in the row's tooltip.
