// Plain REST response DTOs shared between apps/server and apps/web — for
// apps/server's REST surface (currently /stats, /settings), distinct from
// the WS Command/Event types in ws.ts.
//
// These do NOT participate in the PROTOCOL_VERSION handshake: that
// mechanism exists to let the server detect a stale client on a persistent
// WS connection, and a stateless REST request has no equivalent connection
// to negotiate over. They DO still follow the same additive-only
// expand/contract discipline as Command/Event when they change — the
// reason expand/contract exists (backend and frontend deploy independently,
// no atomicity guarantee, see CLAUDE.md "Schema evolution") applies exactly
// as much to a REST response as a WS event; an old frontend can hit a new
// backend's /settings just as easily as it can see a new WordPlayed shape.
// A genuinely breaking REST change should use a versioned path prefix (e.g.
// /v2/settings) or a version header, tolerated alongside the old route for
// one rollout before the old one is retired — the REST analog of
// PROTOCOL_VERSION, not yet needed by anything here.

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

export interface PlayerSettingsResponse {
  language: string;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}
