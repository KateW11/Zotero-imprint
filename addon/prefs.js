/* Defaults. The plugin runs inside Zotero, so it needs no Zotero data
   directory, no working directory and no port -- three settings the
   Python tool's config.json had to carry. */
pref("sourceDir", "");
pref("stagingDir", "");
pref("mirrorDir", "");
pref("crossrefEmail", "");
/* Folders chosen inside a tool window, each overriding the settings above
   for that window only. Kept separate so working on another folder for one
   run never quietly moves where everything else reads and writes. Blank
   means "use the setting". */
pref("intakeDir", "");
pref("annotationsDir", "");
pref("reconcileDir", "");
