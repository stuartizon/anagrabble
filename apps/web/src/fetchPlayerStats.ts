// Response shape hand-duplicated from apps/server/src/stats.ts's
// PlayerStatsResponse (canonical there) rather than shared via
// packages/protocol, which is scoped to the WS wire protocol — see
// docs/decisions.md for the fuller reasoning. Keep the two in sync by hand;
// revisit if a second/third HTTP endpoint makes that actually hurt.
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
  /** Not comparable across games with different minWordLength configs —
   * see docs/postgres-schema.md. */
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

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) throw new Error("VITE_API_URL is not set");

export async function fetchPlayerStats(token: string): Promise<PlayerStatsResponse> {
  const res = await fetch(`${API_URL}/stats`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
  return res.json();
}
