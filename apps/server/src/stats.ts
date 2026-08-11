import { getPlayerStats, type Database, type Kysely, type PlayerStats } from "@anagrabble/postgres";
import { verifyMockSessionToken, verifySessionToken } from "./auth.js";

// Canonical response shape for GET /stats — hand-duplicated (not shared via
// packages/protocol) in apps/web's fetchPlayerStats.ts. packages/protocol
// is scoped to the WS wire protocol (versioned via PROTOCOL_VERSION under
// CLAUDE.md's expand/contract rules); a plain GET response is neither a
// Command nor an Event and shouldn't participate in that versioning
// discipline. See docs/decisions.md for the fuller reasoning.
export interface RecentGame {
  gameId: string;
  endedAt: string; // ISO 8601
  placement: number;
  playerCount: number;
  score: number;
}

export interface PlayerStatsResponse {
  gamesPlayed: number;
  wins: number;
  winRatePct: number | null;
  /** Not comparable across games with different `minWordLength` configs —
   * see packages/postgres's PlayerStats.avgScore. */
  avgScore: number | null;
  highestScore: number | null;
  longestWordPlayed: string | null;
  currentWinStreak: number;
  bestWinStreak: number;
  lifetimeWordsPlayed: number;
  lifetimeScore: number;
  avgGameDurationSec: number | null;
  recentGames: RecentGame[];
}

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
