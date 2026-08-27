// Shared wire types for the WebSocket protocol between apps/server and apps/web.
// See CLAUDE.md "Protocol conventions" — expand/contract schema evolution rules
// apply to every change in this file.

/** Bumped whenever the wire shape changes; sent in the WS handshake so the
 * server can detect a stale client instead of silently misbehaving. */
export const PROTOCOL_VERSION = 3;

export interface BaseCommand {
  commandId: string;
  gameId: string;
}

export interface BaseEvent {
  seq: number;
  gameId: string;
}

/** Sent periodically by a connected client (see apps/web's useGameSocket)
 * purely to keep GameState.players[].lastSeenAt fresh — the presence
 * heartbeat, not a general-purpose keepalive. See docs/decisions.md "Player
 * presence: connected/disconnected tracking". */
export interface PingCommand extends BaseCommand {
  type: "Ping";
}

export interface PongEvent extends BaseEvent {
  type: "Pong";
  /** Present when the pinging connection is seated as a player — lets each
   * client's own heartbeat double as a lightweight resync of everyone
   * else's presence, without a separate server-initiated broadcast on every
   * heartbeat tick. Absent for a viewer who hasn't joined/isn't seated. */
  game?: GameSnapshot;
}

// --- Game state shape ---
// This is also the shape persisted in Redis (see docs/redis-schema.md) — the
// same GameState grows into real gameplay later without restructuring, so
// the lobby slice deliberately fills in placeholder values (empty pool,
// zero bankCount, null turnDeadline) rather than using a lobby-only shape.

export type GameStatus = "lobby" | "playing" | "ended";

export interface GameConfig {
  turnTimerSec: number;
  minWordLength: number;
  language: string;
}

export interface PlayerState {
  id: string;
  name: string;
  /** Claimed words — always empty until word play lands. */
  words: string[];
  score: number;
  /** Epoch ms of the last heartbeat/command received from this player's
   * connection — persisted, never sent to clients directly (clock-skew
   * sensitive). "Reachable" is derived from it at read time rather than
   * tracked via a scheduled timer — see apps/server/src/gameSession.ts's
   * `isReachable` and docs/decisions.md "Player presence:
   * connected/disconnected tracking". Absent for a player who has never
   * connected (shouldn't happen in practice — set on join/create). */
  lastSeenAt?: number;
  /** Derived, wire-only — computed fresh into every GameSnapshot
   * (apps/server/src/gameSession.ts's `toGameSnapshot`), never persisted
   * alongside `lastSeenAt` in Redis. Absent from an older server's
   * snapshot during a rollout window; treat as `"connected"`. */
  presence?: "connected" | "disconnected";
}

export interface GameState {
  status: GameStatus;
  seq: number;
  config: GameConfig;
  /** Identity, not array position — `players[]` never drops a mid-game
   * player on disconnect (see PlayerState's `lastSeenAt` docs below), so a
   * position-based index would cycle through unreachable
   * players. `null` only in the pathological case where every player is
   * currently unreachable — no crash, just "nobody can currently take a
   * turn." See docs/decisions.md "Turn ownership: turnPlayerIndex ->
   * identity-based, not array position". */
  turnPlayerId: string | null;
  turnDeadline: number | null;
  /** Set once bankCount reaches 0, reset to now + 60000ms on every accepted
   * WordPlayed event; null while the bank still has tiles. Same
   * lazy/client-triggered checking pattern as turnDeadline — see CLAUDE.md
   * "Game-end condition". */
  endGameDeadline: number | null;
  bankCount: number;
  pool: string[];
  players: PlayerState[];
}

/** GameState plus the identifiers that live outside the persisted blob
 * (gameId is the Redis key; hostId is derived — see docs/redis-schema.md
 * "host convention"). Sent on connect/join so a freshly-opened tab (or a
 * reconnecting client) doesn't need any state beyond what the server has. */
export interface GameSnapshot extends GameState {
  gameId: string;
  hostId: string;
}

export interface JoinGameCommand extends BaseCommand {
  type: "JoinGame";
  playerName: string;
}

/** Host-only, lobby -> playing. See CLAUDE.md "Tile turning is turn-based" —
 * this is what seeds the shuffled bag and opens the first turn. No
 * client-supplied actor id: the server derives it from the verified Clerk
 * session (see docs/decisions.md "Command identity: derived from the Clerk
 * session, not client-supplied"). */
export interface StartGameCommand extends BaseCommand {
  type: "StartGame";
}

/** Sent by whichever client's local turn-timer state warrants it — the
 * current player turning a tile early — or by the server's own turn-timer
 * sweep once a deadline passes with nobody connected to trigger it (see
 * `apps/server/src/turnTimerSweep.ts`, CLAUDE.md "Turn timer enforcement").
 * The server is the source of truth either way — see packages/redis
 * apply_turn_tile.lua. No client-supplied actor id — same reasoning as
 * StartGameCommand above. */
export interface TurnTileCommand extends BaseCommand {
  type: "TurnTile";
}

/** Any player, any time — see CLAUDE.md "Word submission/stealing is
 * free-for-all". The server infers *how* `word` forms (pool letters,
 * steal, combine) — the client never specifies a decomposition. See
 * packages/game resolveWordPlay and packages/redis apply_submit_word.lua.
 * No client-supplied actor id — same reasoning as StartGameCommand above. */
export interface SubmitWordCommand extends BaseCommand {
  type: "SubmitWord";
  word: string;
}

/** Sent by whichever client's local idle-countdown says `endGameDeadline`
 * has passed (see CLAUDE.md "Game-end condition") — same client-triggered,
 * server-verified pattern as TurnTileCommand, just for the post-bank-empty
 * idle timer instead of the turn timer. No `playerId`: unlike TurnTile,
 * ending the game doesn't depend on who triggers it. See packages/redis
 * apply_end_game.lua. */
export interface EndGameCommand extends BaseCommand {
  type: "EndGame";
}

export interface PlayerJoinedEvent extends BaseEvent {
  type: "PlayerJoined";
  player: PlayerState;
  game: GameSnapshot;
}

export interface PlayerLeftEvent extends BaseEvent {
  type: "PlayerLeft";
  playerId: string;
  game: GameSnapshot;
}

/** Full-state sync — sent on WS connect (when the URL names a game), right
 * after CreateGame is accepted, and any time a client needs to resync rather
 * than trust incremental events (see CLAUDE.md "Sequencing"). */
export interface GameSnapshotEvent extends BaseEvent {
  type: "GameSnapshot";
  game: GameSnapshot;
}

export interface GameStartedEvent extends BaseEvent {
  type: "GameStarted";
  game: GameSnapshot;
}

export interface TileTurnedEvent extends BaseEvent {
  type: "TileTurned";
  game: GameSnapshot;
}

/** The idle countdown (see CLAUDE.md "Game-end condition") expired with no
 * further plays — status has moved to "ended". See packages/redis
 * apply_end_game.lua. */
export interface GameEndedEvent extends BaseEvent {
  type: "GameEnded";
  game: GameSnapshot;
}

/** A claimed word this play consumed — either stolen from another player or
 * (if `ownerId` is the same as `WordPlayedEvent.playerId`) the submitter's
 * own word being extended. Enough for a client to narrate e.g. "Sam stole
 * CAT from You -> CAST" (CLAUDE.md "Core gameplay") from any viewer's
 * perspective without needing to diff successive `game` snapshots itself —
 * `apps/web` currently only narrates the actor's own play as a toast (see
 * docs/decisions.md "Toasts are personal, not broadcast narration"), but
 * the event carries enough for any player's perspective, for whenever the
 * persistent history panel narrates everyone's plays. */
export interface UsedWord {
  word: string;
  ownerId: string;
}

export interface WordPlayedEvent extends BaseEvent {
  type: "WordPlayed";
  playerId: string;
  word: string;
  usedWords: UsedWord[];
  usedPoolLetters: string[];
  game: GameSnapshot;
}

export interface ErrorEvent {
  type: "Error";
  code:
    | "GameNotFound"
    | "GameIdTaken"
    | "GameAlreadyStarted"
    | "GameAlreadyEnded"
    | "GameNotStarted"
    | "NotHost"
    | "NotYourTurn"
    | "PlayerNotFound"
    | "TooShort"
    | "NotAWord"
    | "NoDecomposition"
    | "DerivationBlocked"
    | "StaleState"
    | "GameNotIdle"
    | "InvalidCommand"
    | "Unauthorized"
    | "RateLimited";
  message: string;
  commandId?: string;
  gameId?: string;
}

export type Command =
  | PingCommand
  | JoinGameCommand
  | StartGameCommand
  | TurnTileCommand
  | SubmitWordCommand
  | EndGameCommand;
export type Event =
  | PongEvent
  | PlayerJoinedEvent
  | PlayerLeftEvent
  | GameSnapshotEvent
  | GameStartedEvent
  | TileTurnedEvent
  | WordPlayedEvent
  | GameEndedEvent
  | ErrorEvent;

export interface HandshakeMessage {
  type: "Handshake";
  protocolVersion: number;
}
