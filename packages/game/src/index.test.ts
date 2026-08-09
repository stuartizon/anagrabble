// Smoke test for the current package.game surface. Real coverage (decomposition
// search, priority tiers, tiebreak-by-score) lands via TDD alongside the word-
// submission user story — see CLAUDE.md "Word formability" and the Testing
// strategy section for the plan.

import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG } from "./index.js";

describe("DEFAULT_GAME_CONFIG", () => {
  it("falls within the documented turn-timer range (15-60s)", () => {
    expect(DEFAULT_GAME_CONFIG.turnTimerSec).toBeGreaterThanOrEqual(15);
    expect(DEFAULT_GAME_CONFIG.turnTimerSec).toBeLessThanOrEqual(60);
  });

  it("matches the current defaults", () => {
    expect(DEFAULT_GAME_CONFIG).toEqual({
      turnTimerSec: 30,
      minWordLength: 3,
      language: "en",
    });
  });
});
