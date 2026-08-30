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
  // One retry in CI (anagrabble#52's gating job) — a real-browser/real-WS
  // suite is inherently more timing-sensitive than a unit test, and this is
  // a hard deploy gate now, so a genuine one-off flake shouldn't block a
  // good commit the way it would with zero retries. Local runs stay at 0:
  // a failure while iterating should be investigated, not silently retried.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "html",
  use: {
    baseURL: "http://localhost:5173",
    // "retain-on-failure" rather than "on-first-retry": guarantees a trace
    // on every failed run (including the final, non-retried attempt)
    // instead of only ones that got retried, and works the same locally
    // with 0 retries — "on-first-retry" was previously a no-op here since
    // retries defaulted to 0, so no trace was ever actually captured.
    trace: "retain-on-failure",
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
