import { defineConfig } from "vitest/config";

// Integration tests spin up a real Redis container (see src/lobby.test.ts) —
// image pull + container start comfortably exceeds Vitest's 5s default.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
