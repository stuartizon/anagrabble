import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      "design-system/**",
      "apps/web/playwright-report/**",
      "apps/web/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // The codebase already writes `import type { X }` by convention
      // (see CLAUDE.md protocol/schema notes) — enforce it rather than
      // leaving it to habit.
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/web/public/**/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
    settings: {
      react: { version: "detect" },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // clerkAuth.tsx/mockAuth.tsx deliberately export a mixed bag of
    // components, hooks, and a plain `authModule` object — both files
    // implement the same `AuthModule` interface (see docs/decisions.md
    // "Local dev auth: mock provider, not a Clerk sandbox") so `apps/web`
    // can swap providers at runtime. That shape will never satisfy
    // react-refresh's components-only requirement, so the HMR cost is
    // accepted rather than splitting the module.
    files: ["apps/web/src/auth/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  eslintConfigPrettier,
);
