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
  },
});
