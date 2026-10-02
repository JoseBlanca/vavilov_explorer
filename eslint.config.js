// @ts-check
// The lint of Vavilov Explorer: .claude/skills/coding/typescript.md, "ESLint".
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// What each layer of src/ must not import, from the table of
// .claude/skills/coding/SKILL.md.
const tauri = {
  group: ["@tauri-apps/*"],
  message: "Only src/backend/ talks to Tauri.",
};
const drawing = {
  group: ["d3", "d3-*", "three", "three/*"],
  message: "D3 and Three.js belong to src/plots/.",
};
const templates = {
  group: ["lit-html", "lit-html/*"],
  message: "lit-html belongs to src/windows/.",
};
const backend = { group: ["**/backend/**"], message: "Only src/windows/ uses src/backend/." };
const windows = { group: ["**/windows/**"], message: "Nothing imports src/windows/." };
const plots = { group: ["**/plots/**"], message: "Only src/windows/ uses src/plots/." };

// Node's globals, for the scripts that run in node: the e2e tests and the
// configuration files.
const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  URL: "readonly",
  structuredClone: "readonly",
};

export default defineConfig(
  globalIgnores([
    "dist/",
    "spikes/",
    "src-tauri/target/",
    "src-tauri/gen/",
    "e2e/output/",
    "tmp/",
    ".claude/",
  ]),
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: nodeGlobals },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["vite.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      eqeqeq: "error",
      "prefer-const": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-param-reassign": ["error", { props: true }],
      "no-restricted-exports": [
        "error",
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        { allowString: false, allowNumber: false, allowNullableObject: true },
      ],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [tauri, drawing, templates, backend, windows, plots] },
      ],
    },
  },
  {
    files: ["src/backend/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [drawing, templates, windows, plots] },
      ],
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },
  {
    files: ["src/state/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },
  {
    files: ["src/plots/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [tauri, templates, backend, windows] },
      ],
    },
  },
  {
    files: ["src/windows/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [tauri, drawing] }],
    },
  },
  {
    // The entry of every window starts the window's controller.
    files: ["src/main.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [tauri, drawing, templates, backend, plots] },
      ],
    },
  },
  {
    // A configuration file of a tool exports its configuration by default.
    files: ["vite.config.ts", "eslint.config.js"],
    rules: { "no-restricted-exports": "off" },
  },
);
