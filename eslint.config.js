import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist",
      "**/target",
      "**/coverage",
      "packages/web/src/wasm",
      "infra/cdk.out",
      "**/playwright-report",
      "**/test-results",
      ".lighthouseci",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // React rules only apply to app source; Playwright fixtures have a `use` callback that the
    // hooks rule mistakes for React's `use`.
    files: ["packages/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Test-only pages are entry points, not hot-reloaded component modules.
    files: ["packages/web/src/test-pages/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // noUncheckedIndexedAccess makes every typed-array read `T | undefined`. In audio and
      // render hot loops the index is bounds-correct by construction, and `!` is the
      // zero-cost way to say so.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["**/*.{js,mjs}", "scripts/**"],
    languageOptions: { globals: globals.node },
  },
  {
    // Runs as a service worker; __HEADERS__ is substituted at build time (vite.config.ts).
    files: ["packages/web/src/coi/sw-template.js"],
    languageOptions: { globals: { ...globals.serviceworker, __HEADERS__: "readonly" } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { globals: globals.node, sourceType: "commonjs" },
  },
);
