import type { Redis } from "@anagrabble/redis";
import type {
  CreateGameCommand,
  GameState,
  JoinGameCommand,
  LobbySnapshot,
  PlayerState,
} from "@anagrabble/protocol";

// Redis keys — see docs/redis-schema.md for the full convention. Hash-tagged
// ({<gameId>}) so a future move to clustered Redis keeps all of one game's
// keys on the same slot, which multi-key Lua scripts require. Exported so
// game.ts (StartGame/TurnTile) can address the same keys.
export const stateKey = (gameId: string) => `game:{${gameId}}:state`;
export const seqKey = (gameId: string) => `game:{${gameId}}:seq`;
export const cmdsKey = (gameId: string) => `game:{${gameId}}:cmds`;
/** Shuffled draw order for one game's tile bag — never sent to clients (see
 * packages/game/src/bag.ts and docs/redis-schema.md "Tile bag key"). */
export const bagKey = (gameId: string) => `game:{${gameId}}:bag`;

export const CMDS_TTL_SEC = 3600;

export type LobbyError = "GameNotFound" | "GameIdTaken" | "GameAlreadyStarted";

/** The host is, by convention, whoever is first in `players` — set once at
 * creation and never reordered. No separate hostId is persisted; if the
 * host's own socket disconnects pre-start, leaveGame() removes them and the
 * next player in line becomes host by the same convention (host migration,
 * effectively free). Documented in docs/redis-schema.md. */
function deriveHostId(state: GameState): string {
  return state.players[0]?.id ?? "";
}

export function toLobbySnapshot(gameId: string, state: GameState): LobbySnapshot {
  return { ...state, gameId, hostId: deriveHostId(state) };
}

export async function loadGameState(redis: Redis, gameId: string): Promise<GameState | null> {
  const raw = await redis.get(stateKey(gameId));
  return raw ? (JSON.parse(raw) as GameState) : null;
}

export async function loadLobbySnapshot(
  redis: Redis,
  gameId: string,
): Promise<LobbySnapshot | null> {
  const state = await loadGameState(redis, gameId);
  return state ? toLobbySnapshot(gameId, state) : null;
}

/** Marks a commandId as processed for this game, so retries (reconnect,
 * dropped ack) don't double-apply. Returns whether it was already seen.
 * Exported so game.ts's StartGame (plain read-modify-write, like the rest of
 * the lobby slice) can reuse the same dedup convention TurnTile's Lua script
 * implements atomically. */
export async function markCommandSeen(
  redis: Redis,
  gameId: string,
  commandId: string,
): Promise<boolean> {
  const added = await redis.sadd(cmdsKey(gameId), commandId);
  await redis.expire(cmdsKey(gameId), CMDS_TTL_SEC);
  return added === 0;
}

/** Bumps the dedicated seq counter (single atomic INCR — safe under
 * concurrency on its own) and returns the new value to embed in the state
 * blob being written. */
export async function nextSeq(redis: Redis, gameId: string): Promise<number> {
  return redis.incr(seqKey(gameId));
}

// NOTE on concurrency: writing `state` is a single SET, so any one mutation
// is atomic, but the read-modify-write around it (GET state, compute in JS,
// SET state) is not compare-and-swap — two truly concurrent JoinGame calls
// for the same game could race and one join could clobber the other. Per
// CLAUDE.md this is accepted for the lobby slice (no Lua yet, low odds of
// two joins landing in the same instant); revisit with the same Lua
// re-verification pattern planned for word resolution if it ever matters in
// practice. See docs/redis-schema.md "Known limitations".

export async function createGame(
  redis: Redis,
  cmd: CreateGameCommand,
  hostId: string,
): Promise<{ snapshot: LobbySnapshot } | { error: LobbyError }> {
  const exists = await redis.exists(stateKey(cmd.gameId));
  if (exists) {
    const alreadyApplied = await markCommandSeen(redis, cmd.gameId, cmd.commandId);
    if (alreadyApplied) {
      const snapshot = await loadLobbySnapshot(redis, cmd.gameId);
      if (snapshot) return { snapshot };
    }
    return { error: "GameIdTaken" };
  }

  const host: PlayerState = {
    id: hostId,
    name: cmd.hostName,
    words: [],
    score: 0,
  };
  const state: GameState = {
    status: "lobby",
    seq: 0,
    config: cmd.config,
    turnPlayerIndex: 0,
    turnDeadline: null,
    endGameDeadline: null,
    bankCount: 0,
    pool: [],
    players: [host],
  };

  const multi = redis.multi();
  multi.set(seqKey(cmd.gameId), "0");
  multi.set(stateKey(cmd.gameId), JSON.stringify(state));
  multi.sadd(cmdsKey(cmd.gameId), cmd.commandId);
  multi.expire(cmdsKey(cmd.gameId), CMDS_TTL_SEC);
  await multi.exec();

  return { snapshot: toLobbySnapshot(cmd.gameId, state) };
}

export async function joinGame(
  redis: Redis,
  cmd: JoinGameCommand,
  playerId: string,
): Promise<
  { snapshot: LobbySnapshot; player: PlayerState; isNew: boolean } | { error: LobbyError }
> {
  const state = await loadGameState(redis, cmd.gameId);
  if (!state) return { error: "GameNotFound" };

  const alreadySeen = await markCommandSeen(redis, cmd.gameId, cmd.commandId);
  const existingPlayer = state.players.find((p) => p.id === playerId);

  if (alreadySeen || existingPlayer) {
    return {
      snapshot: toLobbySnapshot(cmd.gameId, state),
      player: existingPlayer ?? state.players[0],
      isNew: false,
    };
  }

  if (state.status !== "lobby") return { error: "GameAlreadyStarted" };

  const player: PlayerState = {
    id: playerId,
    name: cmd.playerName,
    words: [],
    score: 0,
  };

  const seq = await nextSeq(redis, cmd.gameId);
  const nextState: GameState = { ...state, seq, players: [...state.players, player] };
  await redis.set(stateKey(cmd.gameId), JSON.stringify(nextState));

  return { snapshot: toLobbySnapshot(cmd.gameId, nextState), player, isNew: true };
}

/** Removes a player from a not-yet-started lobby (called on socket close).
 * No-op (returns null) once the game has started — leaving mid-game doesn't
 * remove you from the game, but "mid-game" isn't implemented yet either. */
export async function leaveGame(
  redis: Redis,
  gameId: string,
  playerId: string,
): Promise<LobbySnapshot | null> {
  const state = await loadGameState(redis, gameId);
  if (!state || state.status !== "lobby") return null;

  const stillThere = state.players.some((p) => p.id === playerId);
  if (!stillThere) return null;

  const seq = await nextSeq(redis, gameId);
  const nextState: GameState = {
    ...state,
    seq,
    players: state.players.filter((p) => p.id !== playerId),
  };
  await redis.set(stateKey(gameId), JSON.stringify(nextState));

  return toLobbySnapshot(gameId, nextState);
}
