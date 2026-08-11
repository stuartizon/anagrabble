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
    // useGameSocket.ts/fetchPlayerStats.ts throw at import time if these are
    // unset (no localhost fallback, by design — see CLAUDE.md). .env is
    // gitignored and only present locally, so CI needs its own values; these
    // are test-runner-only and don't weaken the real throw-if-unset check.
    env: {
      VITE_WS_URL: "ws://localhost:8080",
      VITE_API_URL: "http://localhost:8080",
    },
  },
});
