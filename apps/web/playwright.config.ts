import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// True end-to-end: real backend, real Redis, real browser — see CLAUDE.md
// "Testing strategy". Assumes Redis is already running (same prerequisite
// as README "Getting started": `docker compose -f infrastructure/docker-
// compose.yml up redis -d`) — not started here, since a dynamically-
// provisioned container's port can't be wired into a static webServer
// command the way it can for the packages/redis and apps/server test
// harnesses.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @anagrabble/server dev",
      cwd: repoRoot,
      url: "http://localhost:8080/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @anagrabble/web dev",
      cwd: repoRoot,
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
