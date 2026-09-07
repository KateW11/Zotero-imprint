// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        // We disable this rule here because the template
        // contains some unused examples and variables
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
    {
      // The window scripts run in a XUL window, not in the plugin bootstrap:
      // they legitimately reach for the DOM, for Components, for Zotero, and
      // for each other's classes across files. Without declaring that, every
      // one of those reads as an undefined global and every window class as
      // unused, which buried the real errors and made `eslint .` unusable as
      // a gate.
      files: ["addon/content/**/*.js"],
      languageOptions: {
        globals: {
          window: "readonly",
          document: "readonly",
          navigator: "readonly",
          location: "readonly",
          setTimeout: "readonly",
          clearTimeout: "readonly",
          setInterval: "readonly",
          clearInterval: "readonly",
          alert: "readonly",
          console: "readonly",
          Components: "readonly",
          Services: "readonly",
          Zotero: "readonly",
          IOUtils: "readonly",
          PathUtils: "readonly",
          FilePicker: "readonly",
          // Declared in one window script and used from the others.
          Picker: "readonly",
        },
      },
      rules: {
        // A window class is referenced from the XHTML that loads it, which
        // ESLint cannot see.
        "no-unused-vars": "off",
      },
    },
    {
      // Each of these files groups several describe() blocks by the function
      // under test, which is how the suite is meant to read.
      files: ["test/**/*.ts"],
      rules: {
        "mocha/max-top-level-suites": ["error", { limit: 6 }],
      },
    },
  ],
});
