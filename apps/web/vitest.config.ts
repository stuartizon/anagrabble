import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // e2e/ holds Playwright specs (`pnpm test:e2e`), not Vitest ones —
    // Vitest's default include glob would otherwise pick them up too.
    exclude: [...configDefaults.exclude, "e2e/**"],
    // Default 5s has flaked under a busy machine (e.g. the pre-push hook's
    // lint/format/typecheck/test run competing with other local processes)
    // even on tests with no deliberate delays — see LoginPage.test.tsx's
    // "returns to the page RequireAuth redirected from" history. Matches
    // apps/server's testTimeout bump for the same reason.
    testTimeout: 15_000,
  },
});
