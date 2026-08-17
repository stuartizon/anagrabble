// Plain REST response DTOs shared between apps/server and apps/web — for
// apps/server's REST surface (currently /stats, /settings, /games),
// distinct from the WS Command/Event types in ws.ts.
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

import type { GameConfig } from "./ws.js";

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

/** POST /games body. Neither `gameId` nor `commandId` is supplied here —
 * both are synthesized server-side (`apps/server/src/games.ts`).
 * `gameId`: standard REST semantics, the
 * server assigns and returns the resource's identity (see
 * docs/decisions.md "CreateGame as a REST endpoint"). `commandId`:
 * `createGame()` (apps/server/src/lobby.ts) records one as part of its
 * per-game command-dedup set regardless of caller, but that dedup logic
 * only ever matters when a caller might legitimately resubmit the exact
 * same `gameId`+`commandId` pair (WS's genuine fire-and-forget
 * retry/reconnect case) — REST's collision-retry loop never reuses a
 * `gameId` across attempts, so a fresh server-generated `commandId` (never
 * matching anything already recorded) produces identical, correct
 * behavior to a client-supplied one. Response is the created game's
 * LobbySnapshot (ws.ts) — no separate response type needed, it's the same
 * shape the WS path already produces via toLobbySnapshot(). */
export interface CreateGameRequest {
  hostName: string;
  config: GameConfig;
}
