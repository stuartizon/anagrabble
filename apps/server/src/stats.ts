import { getPlayerStats, type Database, type Kysely, type PlayerStats } from "@anagrabble/postgres";
import type { PlayerStatsResponse } from "@anagrabble/protocol";
import { verifyMockSessionToken, verifySessionToken } from "./auth.js";

export interface StatsRequestResult {
  status: 200 | 401 | 500;
  body: PlayerStatsResponse | { error: string };
}

function toResponse(stats: PlayerStats): PlayerStatsResponse {
  return {
    gamesPlayed: stats.gamesPlayed,
    wins: stats.wins,
    winRatePct: stats.winRatePct,
    avgScore: stats.avgScore,
    highestScore: stats.highestScore,
    longestWordPlayed: stats.longestWordPlayed,
    currentWinStreak: stats.currentWinStreak,
    bestWinStreak: stats.bestWinStreak,
    lifetimeWordsPlayed: stats.lifetimeWordsPlayed,
    lifetimeScore: stats.lifetimeScore,
    avgGameDurationSec: stats.avgGameDurationSec,
    recentGames: stats.recentGames.map((game) => ({
      gameId: game.gameId,
      endedAt: game.endedAt.toISOString(),
      placement: game.placement,
      playerCount: game.playerCount,
      score: game.finalScore,
    })),
  };
}

function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/** GET /stats. Kept framework-agnostic (no Fastify request/reply types in
 * this signature) so it's directly unit-testable — Fastify's own routing
 * already handles method dispatch, so there's no manual method check here.
 * Unlike every other Postgres call in index.ts (insertGame/insertWordPlay/
 * endGame, all fire-and-forget), this one is awaited and its outcome
 * mapped straight to an HTTP response — the first call site of that shape
 * in this app. */
export async function handleStatsRequest(
  db: Kysely<Database>,
  clerkSecretKey: string,
  authorizationHeader: string | undefined,
  authMode?: string,
): Promise<StatsRequestResult> {
  const token = parseBearerToken(authorizationHeader);
  const auth = token
    ? authMode === "mock"
      ? verifyMockSessionToken(token)
      : await verifySessionToken(token, clerkSecretKey)
    : null;
  if (!auth) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  try {
    const stats = await getPlayerStats(db, auth.userId);
    return { status: 200, body: toResponse(stats) };
  } catch (err) {
    console.error("[http] error computing player stats", err);
    return { status: 500, body: { error: "Internal error" } };
  }
}
