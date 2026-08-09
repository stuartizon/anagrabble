// Shared wire types for the WebSocket protocol between apps/server and apps/web.
// See CLAUDE.md "Protocol conventions" — expand/contract schema evolution rules
// apply to every change in this package.

/** Bumped whenever the wire shape changes; sent in the WS handshake so the
 * server can detect a stale client instead of silently misbehaving. */
export const PROTOCOL_VERSION = 1;

export interface BaseCommand {
  commandId: string;
  gameId: string;
}

export interface BaseEvent {
  seq: number;
  gameId: string;
}

// Placeholder command/event — real game commands (TurnTile, SubmitWord, ...)
// land alongside packages/game implementation.
export interface PingCommand extends BaseCommand {
  type: "Ping";
}

export interface PongEvent extends BaseEvent {
  type: "Pong";
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
}

export interface GameState {
  status: GameStatus;
  seq: number;
  config: GameConfig;
  turnPlayerIndex: number;
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
export interface LobbySnapshot extends GameState {
  gameId: string;
  hostId: string;
}

export interface CreateGameCommand extends BaseCommand {
  type: "CreateGame";
  hostId: string;
  hostName: string;
  config: GameConfig;
}

export interface JoinGameCommand extends BaseCommand {
  type: "JoinGame";
  playerId: string;
  playerName: string;
}

/** Host-only, lobby -> playing. See CLAUDE.md "Tile turning is turn-based" —
 * this is what seeds the shuffled bag and opens the first turn. */
export interface StartGameCommand extends BaseCommand {
  type: "StartGame";
  hostId: string;
}

/** Sent by whichever client's local turn-timer state warrants it: the
 * current player turning a tile early, or (per CLAUDE.md "Turn timer
 * enforcement") any connected client once its local countdown says the
 * deadline has passed. The server is the source of truth either way — see
 * packages/redis apply_turn_tile.lua. */
export interface TurnTileCommand extends BaseCommand {
  type: "TurnTile";
  playerId: string;
}

export interface PlayerJoinedEvent extends BaseEvent {
  type: "PlayerJoined";
  player: PlayerState;
  lobby: LobbySnapshot;
}

export interface PlayerLeftEvent extends BaseEvent {
  type: "PlayerLeft";
  playerId: string;
  lobby: LobbySnapshot;
}

/** Full-state sync — sent on WS connect (when the URL names a game), right
 * after CreateGame is accepted, and any time a client needs to resync rather
 * than trust incremental events (see CLAUDE.md "Sequencing"). */
export interface LobbyStateEvent extends BaseEvent {
  type: "LobbyState";
  lobby: LobbySnapshot;
}

export interface GameStartedEvent extends BaseEvent {
  type: "GameStarted";
  lobby: LobbySnapshot;
}

export interface TileTurnedEvent extends BaseEvent {
  type: "TileTurned";
  lobby: LobbySnapshot;
}

export interface ErrorEvent {
  type: "Error";
  code:
    | "GameNotFound"
    | "GameIdTaken"
    | "GameAlreadyStarted"
    | "GameNotStarted"
    | "NotHost"
    | "NotEnoughPlayers"
    | "NotYourTurn"
    | "InvalidCommand";
  message: string;
  commandId?: string;
  gameId?: string;
}

export type Command =
  PingCommand | CreateGameCommand | JoinGameCommand | StartGameCommand | TurnTileCommand;
export type Event =
  | PongEvent
  | PlayerJoinedEvent
  | PlayerLeftEvent
  | LobbyStateEvent
  | GameStartedEvent
  | TileTurnedEvent
  | ErrorEvent;

export interface HandshakeMessage {
  type: "Handshake";
  protocolVersion: number;
}
