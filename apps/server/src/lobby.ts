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

export type LobbyError = "GameNotFound" | "GameIdTaken" | "GameAlreadyStarted" | "GameAlreadyEnded";

/** How long without a heartbeat before a player is treated as unreachable.
 * Mirrored exactly in apply_turn_tile.lua's PRESENCE_STALE_MS — the two must
 * stay in sync, Lua can't import this constant. See docs/decisions.md
 * "Player presence: connected/disconnected/left tracking". */
const PRESENCE_STALE_MS = 20_000;

/** "Reachable" is derived at read time from `lastSeenAt`, never tracked via
 * a scheduled timer — this is what let this replace the old pendingLeaves
 * debounce (a per-process setTimeout Map) with something any node can
 * compute the same way. Missing `lastSeenAt` (shouldn't happen for a real
 * player — set on join/create below) defaults to "just seen" rather than
 * "long gone", failing open rather than treating incomplete data as absence. */
export function isReachable(player: PlayerState, now: number): boolean {
  if (player.left) return false;
  const lastSeenAt = player.lastSeenAt ?? now;
  return now - lastSeenAt < PRESENCE_STALE_MS;
}

function presenceOf(player: PlayerState, now: number): NonNullable<PlayerState["presence"]> {
  if (player.left) return "left";
  return isReachable(player, now) ? "connected" : "disconnected";
}

/** The host is, by convention, the first *reachable* player in `players`,
 * falling back to `players[0]` if nobody currently is — set once at
 * creation and never reordered, no separate hostId persisted. This means a
 * disconnected host doesn't have to be removed from `players` for host
 * status to migrate: it's computed fresh on every read, same as
 * `presenceOf` above. Documented in docs/redis-schema.md. Exported so
 * game.ts's StartGame authorization check derives host the same way this
 * does, rather than keeping its own separate `players[0]` comparison that
 * could silently diverge from what's displayed as host. */
export function deriveHostId(state: GameState, now: number): string {
  return (state.players.find((p) => isReachable(p, now)) ?? state.players[0])?.id ?? "";
}

export function toLobbySnapshot(gameId: string, state: GameState, now = Date.now()): LobbySnapshot {
  return {
    ...state,
    gameId,
    hostId: deriveHostId(state, now),
    players: state.players.map((p) => ({ ...p, presence: presenceOf(p, now) })),
  };
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
    lastSeenAt: Date.now(),
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

  if (state.status === "ended") return { error: "GameAlreadyEnded" };

  const player: PlayerState = {
    id: playerId,
    name: cmd.playerName,
    words: [],
    score: 0,
    lastSeenAt: Date.now(),
  };

  const seq = await nextSeq(redis, cmd.gameId);
  const nextState: GameState = { ...state, seq, players: [...state.players, player] };
  await redis.set(stateKey(cmd.gameId), JSON.stringify(nextState));

  return { snapshot: toLobbySnapshot(cmd.gameId, nextState), player, isNew: true };
}

/** Removes a player from a not-yet-started lobby (called on socket close).
 * No-op (returns null) once the game has started — there's no mid-game
 * leave yet, only mid-game join (see `joinGame` above). */
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
