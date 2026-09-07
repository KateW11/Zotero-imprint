# Development

Needs Node LTS.

```
npm install
npm start           # launches Zotero with the plugin, reloads on save
npm run build       # writes .scaffold/build/imprint.xpi
npm test            # runs the test suite inside Zotero
npm run lint:check  # prettier and eslint
```

`npm start` needs a development Zotero profile and the path to the Zotero
binary, both set in `.env` — copy `.env.example` and fill it in. Create the
profile with `/Applications/Zotero.app/Contents/MacOS/zotero -P`. Point
`ZOTERO_PLUGIN_DATA_DIR` at a _copy_ of a library if you want real items to
test against, never the live one.

Test an installed build, not just the development one — some problems only
appear on a cold start.

## Tests

161 cases across 13 files in `test/`, making 258 assertions. `npm test` runs
them inside Zotero through the scaffold, so it needs the same `.env` as
`npm start`.

They are regression cases rather than coverage. Almost every one is a specific
thing this plugin got wrong on a real library of 150 papers, written down so it
cannot come back:

- **Reading the DOI.** A DOI printed across a line break, which extraction
  truncates into a shorter string that still looks well formed. A DOI cited in
  a paper's abstract, taken as the paper's own because it happened to be
  emitted first. A journal-level DOI in four publishers' spellings. A
  supplement's own DOI read as the article's.
- **Matching a filename to an item.** A filename that is a strict prefix of a
  different paper's title — Part I against Part II, a paper against its own
  corrigendum. A title Zotero truncated at 100 characters, which has to match
  anyway. The two pull in opposite directions, which is the whole difficulty.
- **The bibliographic search.** A review of a book, whose title quotes the
  book's title and so scores against a filename exactly as well as the book
  would. A filename carrying only the main title of a subtitled paper, which
  has to resolve rather than fall through.
- **Names.** `van de Leemput`, `Grimmer, Hilary` and `John Smith Jr.` — three
  shapes a single name field arrives in, each breaking a different assumption
  about where the surname is.
- **Writing things out.** A highlight beginning with `=`, which a spreadsheet
  evaluates as a formula. An export destination that turns out to hold the
  library's own clean originals.
- **Stopping a run.** A stop asked for at the very end of one run must not
  still be set when the next one starts.

Every case carries a comment saying what it defends against, because a test
whose reason is not written down gets deleted the first time it is
inconvenient.

One case cannot run headlessly: `startup` asserts the plugin instance is
registered with Zotero, which needs the application. The rest run against
stubs.
