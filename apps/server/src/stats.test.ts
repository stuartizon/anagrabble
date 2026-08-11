// Unit tests, not integration — handleStatsRequest is a thin auth/dispatch
// wrapper around getPlayerStats, so query correctness is
// packages/postgres/src/stats.test.ts's job (real Postgres via
// testcontainers). What's ours to verify here is auth/status-code/
// response-shape wiring, same split as auth.test.ts.

import { describe, expect, it, vi } from "vitest";
import type { Database, Kysely, PlayerStats } from "@anagrabble/postgres";

const verifySessionToken = vi.fn();
vi.mock("./auth.js", () => ({
  verifySessionToken: (...args: unknown[]) => verifySessionToken(...args),
}));

const getPlayerStats = vi.fn();
vi.mock("@anagrabble/postgres", () => ({
  getPlayerStats: (...args: unknown[]) => getPlayerStats(...args),
}));

const { handleStatsRequest } = await import("./stats.js");

// getPlayerStats is mocked above — the real Kysely instance is never touched.
const FAKE_DB = {} as Kysely<Database>;

const SAMPLE_STATS: PlayerStats = {
  gamesPlayed: 2,
  wins: 1,
  winRatePct: 50,
  avgScore: 15,
  highestScore: 20,
  longestWordPlayed: "CASTS",
  currentWinStreak: 1,
  bestWinStreak: 1,
  lifetimeWordsPlayed: 10,
  lifetimeScore: 30,
  avgGameDurationSec: 600,
  recentGames: [
    {
      gameId: "game-2",
      startedAt: new Date("2026-01-02T00:00:00Z"),
      endedAt: new Date("2026-01-02T00:10:00Z"),
      finalScore: 10,
      playerCount: 2,
      placement: 2,
      isWin: false,
    },
  ],
};

describe("handleStatsRequest", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const result = await handleStatsRequest(FAKE_DB, "sk_test", undefined);

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(verifySessionToken).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header isn't a Bearer token", async () => {
    const result = await handleStatsRequest(FAKE_DB, "sk_test", "not-a-bearer-token");

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(verifySessionToken).not.toHaveBeenCalled();
  });

  it("returns 401 when the token fails to verify", async () => {
    verifySessionToken.mockResolvedValue(null);

    const result = await handleStatsRequest(FAKE_DB, "sk_test", "Bearer bad-token");

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
  });

  it("returns 200 with the mapped stats for a valid token", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    getPlayerStats.mockResolvedValue(SAMPLE_STATS);

    const result = await handleStatsRequest(FAKE_DB, "sk_test", "Bearer good-token");

    expect(verifySessionToken).toHaveBeenCalledWith("good-token", "sk_test");
    expect(getPlayerStats).toHaveBeenCalledWith(FAKE_DB, "user_1");
    expect(result).toEqual({
      status: 200,
      body: {
        gamesPlayed: 2,
        wins: 1,
        winRatePct: 50,
        avgScore: 15,
        highestScore: 20,
        longestWordPlayed: "CASTS",
        currentWinStreak: 1,
        bestWinStreak: 1,
        lifetimeWordsPlayed: 10,
        lifetimeScore: 30,
        avgGameDurationSec: 600,
        recentGames: [
          {
            gameId: "game-2",
            endedAt: "2026-01-02T00:10:00.000Z",
            placement: 2,
            playerCount: 2,
            score: 10,
          },
        ],
      },
    });
  });

  it("returns 500 and logs when getPlayerStats rejects", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    getPlayerStats.mockRejectedValue(new Error("db exploded"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await handleStatsRequest(FAKE_DB, "sk_test", "Bearer good-token");

    expect(result).toEqual({ status: 500, body: { error: "Internal error" } });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
