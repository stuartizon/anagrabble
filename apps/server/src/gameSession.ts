import type { Redis } from "@anagrabble/redis";
import type {
  CreateGameRequest,
  GameSnapshot,
  GameState,
  JoinGameCommand,
  PlayerState,
} from "@anagrabble/protocol";
import { reportError } from "./observability.js";

/** gameId/commandId aren't part of CreateGameRequest (the REST body) since
 * both are synthesized server-side (apps/server/src/games.ts) — see that
 * file's doc comment. */
export type CreateGameParams = CreateGameRequest & { gameId: string; commandId: string };

// Redis keys — see docs/redis-schema.md for the full convention. Hash-tagged
// ({<gameId>}) so a future move to clustered Redis keeps all of one game's
// keys on the same slot, which multi-key Lua scripts require. Exported so
// game.ts (StartGame/TurnTile) can address the same keys.
export const stateKey = (gameId: string) => `game:{${gameId}}:state`;
export const seqKey = (gameId: string) => `game:{${gameId}}:seq`;
/** Recently-seen commandIds, scored by when each was seen — see
 * markCommandSeen. Renamed from `:cmds` when it changed from a set to a
 * sorted set (anagrabble#56), so no command ever hits a key of the old
 * type; the old keys expire by themselves. */
export const cmdsKey = (gameId: string) => `game:{${gameId}}:recentCmds`;
/** Shuffled draw order for one game's tile bag — never sent to clients (see
 * packages/game/src/bag.ts and docs/redis-schema.md "Tile bag key"). */
export const bagKey = (gameId: string) => `game:{${gameId}}:bag`;

/** A single cross-game sorted set (not hash-tagged — it's an index over
 * every game, not one game's own keys), member = gameId, score = the
 * earliest ms-epoch timestamp at which that game next needs the sweep's
 * attention. What `turnTimerSweep.ts` polls (`ZRANGEBYSCORE ... -inf now`)
 * to force-advance a turn even with nobody connected to trigger it — see
 * docs/decisions.md "Turn-timer polling sweep". Deliberately maintained
 * from Node (syncTurnDeadlineTracking below), not from inside
 * apply_turn_tile.lua/apply_submit_word.lua: those scripts stay scoped to
 * one game's hash-tagged keys (CLAUDE.md "Testing strategy" / the cluster
 * hash-tag convention above), and this is just a work queue, not
 * authoritative state — a stale or missing entry is harmless because the
 * sweep's actual mutation still goes through the same atomic
 * re-verification every other TurnTile call does.
 *
 * The score folds together *both* reasons a turn can need force-advancing
 * (see syncTurnDeadlineTracking) rather than tracking them as two separate
 * sorted sets — one `ZRANGEBYSCORE` per sweep tick covers either case, and
 * `apply_turn_tile.lua`'s existing `deadlinePassed OR
 * currentPlayerUnreachable` check (unchanged) is what actually decides
 * which applies. */
export const TURN_DEADLINES_KEY = "games:turnDeadlines";

/** Pure: the earliest ms-epoch timestamp at which `state`'s game next needs
 * the sweep's attention, or `null` if it doesn't need tracking at all right
 * now (not playing, or the bank is empty — see syncTurnDeadlineTracking
 * below for why). Split out from that function specifically so it has no
 * Redis dependency and nothing to await — `turnTimerSweep.test.ts` calls it
 * directly to seed a deterministic tracked score for a test, which is the
 * only place in this codebase that ever needed anything other than "fire
 * this write and move on."
 *
 * The returned value is `min(turnDeadline, currentPlayer's presence
 * deadline)`, not just `turnDeadline`: a current player can go unreachable
 * (CLAUDE.md "Disconnected-player fast-skip") well before their nominal
 * turnDeadline, and `apply_turn_tile.lua` already accepts a force-advance
 * early in that case (`currentPlayerUnreachable`) — the tracked score has
 * to account for that too, or the sweep would only ever notice once the
 * full turnTimerSec had elapsed regardless of presence. "Presence
 * deadline" is exactly `lastSeenAt + PRESENCE_STALE_MS` — the same
 * `isReachable` boundary the Lua script and the frontend's greyed-out
 * display already use (see docs/redis-schema.md "Presence"), just
 * expressed as a future timestamp instead of a live now-vs-lastSeenAt
 * check, so it can sit in the same deadline-indexed sorted set as
 * `turnDeadline` — no scanning, no separate presence-polling loop: once
 * real time crosses a stale player's already-known presence deadline, the
 * ordinary `ZRANGEBYSCORE` poll picks the game up on its own, exactly like
 * an ordinary expired turn. The returned value is only ever a "when to
 * bother checking" hint, never the authority — `apply_turn_tile.lua`
 * re-derives both conditions fresh from live state at call time.
 *
 * Also `null` while nobody in the game is reachable: apply_turn_tile.lua
 * no-ops when there's no one to hand the turn to, so a tracked due time
 * would just sit in the past and get retried every sweep tick, forever
 * (anagrabble#55). A presence stamp that makes the game reachable again
 * re-tracks it — see presenceStampAffectsSweep below. */
export function computeSweepDueAt(state: GameState, now: number = Date.now()): number | null {
  if (
    state.status !== "playing" ||
    state.bankCount <= 0 ||
    typeof state.turnDeadline !== "number" ||
    !state.players.some((p) => isReachable(p, now))
  ) {
    return null;
  }
  const currentPlayer = state.players.find((p) => p.id === state.turnPlayerId);
  const presenceDeadline = (currentPlayer?.lastSeenAt ?? now) + PRESENCE_STALE_MS;
  return Math.min(state.turnDeadline, presenceDeadline);
}

/** Whether a presence stamp for `playerId` (already applied, giving
 * `state`) can have changed computeSweepDueAt's answer, so the caller
 * needs to re-sync tracking. True for the current player, whose presence
 * deadline is part of the due time; and for anyone who is now the *only*
 * reachable player, since that stamp may have just taken the game out of
 * computeSweepDueAt's nobody-reachable case, and nothing else would put it
 * back in tracking. Any other stamp leaves the due time unchanged, so it
 * skips the write. */
export function presenceStampAffectsSweep(
  state: GameState,
  playerId: string,
  now: number = Date.now(),
): boolean {
  return (
    state.turnPlayerId === playerId ||
    !state.players.some((p) => p.id !== playerId && isReachable(p, now))
  );
}

/** Keeps `TURN_DEADLINES_KEY` in sync with `computeSweepDueAt(state)` —
 * call after every mutation that can change `turnDeadline` or
 * `turnPlayerId` (StartGame/TurnTile/SubmitWord), and after every presence
 * update that can change the due time (see presenceStampAffectsSweep,
 * used by wsConnection.ts's Ping handler/reconnect stamp; broadcast.ts's
 * markDisconnected only needs the current-player check, since a player
 * going *away* can't bring an untracked game back).
 *
 * Fire-and-forget, deliberately: nothing in this codebase ever needs to
 * wait for this write to land before doing something else — the tracked
 * score is a work queue for the sweep, not authoritative state (a stale or
 * missing entry is harmless, since the sweep's actual mutation still goes
 * through apply_turn_tile.lua's ordinary atomic re-verification), so
 * there's no correctness reason a TurnTile/SubmitWord/Ping response should
 * ever block on it — see docs/decisions.md "Sweep-tracking writes are
 * fire-and-forget, not on the gameplay critical path". Returns `void`, not
 * a `Promise`, so a call site can't accidentally end up awaiting (and thus
 * blocking on) it by construction, not just by convention. Untracks once
 * there's nothing left for the sweep to do (computeSweepDueAt returns
 * `null`): the game isn't playing, nobody in it is reachable, or the bank
 * is empty (TurnTile is a
 * permanent no-op past that point — see apply_turn_tile.lua's
 * bankCount<=0 branch — so there's no expired-turn work to sweep for, even
 * though SubmitWord keeps resetting turnDeadline for scoring/steal
 * purposes). */
export function syncTurnDeadlineTracking(redis: Redis, gameId: string, state: GameState): void {
  const dueAt = computeSweepDueAt(state);
  const write =
    dueAt === null
      ? redis.zRem(TURN_DEADLINES_KEY, gameId)
      : redis.zAdd(TURN_DEADLINES_KEY, { score: dueAt, value: gameId });
  write.catch((err) => reportError(err, { tags: { op: "turnTimer.syncTracking", gameId } }));
}

/** Fire-and-forget removal from TURN_DEADLINES_KEY — same reasoning as
 * syncTurnDeadlineTracking above, for the handful of call sites (a game
 * confirmed gone, or ended) that just need it untracked and have no
 * `state` to hand computeSweepDueAt. */
export function untrackTurnDeadline(redis: Redis, gameId: string): void {
  redis
    .zRem(TURN_DEADLINES_KEY, gameId)
    .catch((err) => reportError(err, { tags: { op: "turnTimer.untrack", gameId } }));
}

export const CMDS_TTL_SEC = 3600;

/** How long a game's keys (state, seq, bag) live after its last real
 * mutation (anagrabble#58). Every mutation resets it on all of them
 * together, so an active game never expires, an ended game's results page
 * keeps working for a week, and an abandoned game is cleaned up a week
 * after anyone last touched it. Postgres holds the permanent history. A
 * presence heartbeat isn't a mutation: apply_presence.lua keeps the
 * existing TTL rather than resetting it. */
export const GAME_TTL_SEC = 7 * 24 * 60 * 60;

/** Queues a reset of the game's TTL on all its keys together, so they never
 * drift apart (a `seq` expiring under a live `state` would restart the
 * counter). Needed after every plain `SET` of the state key too, since a
 * `SET` drops the key's TTL. The apply_*.lua scripts do the same inline. */
export function expireGameKeys(multi: ReturnType<Redis["multi"]>, gameId: string): void {
  for (const key of [stateKey(gameId), seqKey(gameId), bagKey(gameId)]) {
    multi.expire(key, GAME_TTL_SEC);
  }
}

export type GameSessionError =
  "GameNotFound" | "GameIdTaken" | "GameAlreadyStarted" | "GameAlreadyEnded";

/** How long without a heartbeat before a player is treated as unreachable.
 * Passed into apply_turn_tile.lua as an EVAL argument (see game.ts's
 * turnTile) rather than duplicated as a Lua literal — Redis's sandboxed Lua
 * can't read a config file or env var to get it independently, so this is
 * the single source of truth and Lua just receives whatever it's given.
 * See docs/decisions.md "Player presence: connected/disconnected
 * tracking". Still a hardcoded constant here, not yet an env var — see
 * CLAUDE.md "Still open" for the planned follow-up making it ops-tunable
 * without a redeploy. */
export const PRESENCE_STALE_MS = 10_000;

/** "Reachable" is derived at read time from `lastSeenAt`, never tracked via
 * a scheduled timer — this is what let this replace the old pendingLeaves
 * debounce (a per-process setTimeout Map) with something any node can
 * compute the same way. Missing `lastSeenAt` (shouldn't happen for a real
 * player — set on join/create below) defaults to "just seen" rather than
 * "long gone", failing open rather than treating incomplete data as absence. */
export function isReachable(player: PlayerState, now: number): boolean {
  const lastSeenAt = player.lastSeenAt ?? now;
  return now - lastSeenAt < PRESENCE_STALE_MS;
}

function presenceOf(player: PlayerState, now: number): NonNullable<PlayerState["presence"]> {
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

/** Builds the wire-sent snapshot from the persisted `GameState` blob. */
export function toGameSnapshot(gameId: string, state: GameState, now = Date.now()): GameSnapshot {
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

export async function loadGameSnapshot(redis: Redis, gameId: string): Promise<GameSnapshot | null> {
  const state = await loadGameState(redis, gameId);
  return state ? toGameSnapshot(gameId, state) : null;
}

/** Marks a commandId as processed for this game, so retries (reconnect,
 * dropped ack) don't double-apply. Returns whether it was already seen.
 * Exported so game.ts's StartGame (plain read-modify-write, like the rest of
 * the lobby slice) can reuse the same dedup convention TurnTile's Lua script
 * implements atomically.
 *
 * Each commandId is remembered for CMDS_TTL_SEC from when it was seen, not
 * from the game's latest command: entries older than the window are trimmed
 * on every write (anagrabble#56). Mirrors the dedup block at the top of each
 * apply_*.lua script. */
export async function markCommandSeen(
  redis: Redis,
  gameId: string,
  commandId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const multi = redis.multi();
  addCommandSeen(multi, gameId, commandId, now);
  const replies = await multi.exec();
  return Number(replies[1]) === 0;
}

function addCommandSeen(
  multi: ReturnType<Redis["multi"]>,
  gameId: string,
  commandId: string,
  now: number,
): void {
  const windowMs = CMDS_TTL_SEC * 1000;
  multi.zRemRangeByScore(cmdsKey(gameId), "-inf", now - windowMs);
  multi.zAdd(cmdsKey(gameId), { score: now, value: commandId }, { condition: "NX" });
  multi.pExpire(cmdsKey(gameId), windowMs);
}

/** Writes the state blob and resets the game's TTL in one step — see
 * expireGameKeys. */
async function writeGameState(redis: Redis, gameId: string, state: GameState): Promise<void> {
  const multi = redis.multi();
  multi.set(stateKey(gameId), JSON.stringify(state));
  expireGameKeys(multi, gameId);
  await multi.exec();
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
  cmd: CreateGameParams,
  hostId: string,
): Promise<{ snapshot: GameSnapshot } | { error: GameSessionError }> {
  const exists = await redis.exists(stateKey(cmd.gameId));
  if (exists) {
    const alreadyApplied = await markCommandSeen(redis, cmd.gameId, cmd.commandId);
    if (alreadyApplied) {
      const snapshot = await loadGameSnapshot(redis, cmd.gameId);
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
    turnPlayerId: hostId,
    turnDeadline: null,
    endGameDeadline: null,
    bankCount: 0,
    pool: [],
    players: [host],
  };

  const multi = redis.multi();
  multi.set(seqKey(cmd.gameId), "0");
  multi.set(stateKey(cmd.gameId), JSON.stringify(state));
  expireGameKeys(multi, cmd.gameId);
  addCommandSeen(multi, cmd.gameId, cmd.commandId, Date.now());
  await multi.exec();

  return { snapshot: toGameSnapshot(cmd.gameId, state) };
}

export async function joinGame(
  redis: Redis,
  cmd: JoinGameCommand,
  playerId: string,
): Promise<
  { snapshot: GameSnapshot; player: PlayerState; isNew: boolean } | { error: GameSessionError }
> {
  const state = await loadGameState(redis, cmd.gameId);
  if (!state) return { error: "GameNotFound" };

  const alreadySeen = await markCommandSeen(redis, cmd.gameId, cmd.commandId);
  const existingPlayer = state.players.find((p) => p.id === playerId);

  if (alreadySeen || existingPlayer) {
    return {
      snapshot: toGameSnapshot(cmd.gameId, state),
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
  await writeGameState(redis, cmd.gameId, nextState);

  return { snapshot: toGameSnapshot(cmd.gameId, nextState), player, isNew: true };
}

/** Removes a player from a not-yet-started lobby. The only caller today is
 * the explicit `POST /games/:gameId/leave` REST handler — not socket close,
 * which only ever patches presence (`markDisconnected` in index.ts), never
 * touches `players[]`. No-op (returns null) once the game has started:
 * mid-game, nobody is ever removed from `players[]`, connected or not —
 * that's the deliberate, permanent design (see docs/decisions.md "Player
 * presence: connected/disconnected tracking"), not a gap pending a future
 * mid-game leave. `GamePage/index.tsx` only calls this endpoint pre-start
 * now; this no-op branch mainly guards the rare race where a client's local
 * game status is still briefly stale right as the host starts the game. */
export async function leaveGame(
  redis: Redis,
  gameId: string,
  playerId: string,
): Promise<GameSnapshot | null> {
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
  await writeGameState(redis, gameId, nextState);

  return toGameSnapshot(gameId, nextState);
}
