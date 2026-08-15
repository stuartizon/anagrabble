import {
  applyEndGame,
  applySubmitWord,
  applyTurnTile,
  type ApplySubmitWordError,
  type Redis,
} from "@anagrabble/redis";
import {
  createShuffledBag,
  resolveWordPlay,
  type ClaimedWord,
  type WordPlayError,
} from "@anagrabble/game";
import type {
  EndGameCommand,
  GameState,
  LobbySnapshot,
  StartGameCommand,
  SubmitWordCommand,
  TurnTileCommand,
  UsedWord,
} from "@anagrabble/protocol";
import {
  CMDS_TTL_SEC,
  bagKey,
  cmdsKey,
  deriveHostId,
  loadGameState,
  loadLobbySnapshot,
  markCommandSeen,
  nextSeq,
  seqKey,
  stateKey,
  toLobbySnapshot,
  type LobbyError,
} from "./lobby.js";

export type StartGameError = LobbyError | "NotHost";
export type TurnTileError = "GameNotFound" | "GameNotStarted" | "NotYourTurn";

/** Host-only lobby -> playing transition: shuffles the tile bag (see
 * packages/game/src/bag.ts) and opens the first turn. Plain read-modify-
 * write, same as the rest of the lobby slice (docs/redis-schema.md "Known
 * limitations") — unlike TurnTile, there's no genuine concurrent-writer race
 * here worth a Lua script for (only the host can trigger it, and retrying
 * with the same commandId is idempotent). */
export async function startGame(
  redis: Redis,
  cmd: StartGameCommand,
  hostId: string,
): Promise<{ snapshot: LobbySnapshot } | { error: StartGameError }> {
  const state = await loadGameState(redis, cmd.gameId);
  if (!state) return { error: "GameNotFound" };

  const alreadySeen = await markCommandSeen(redis, cmd.gameId, cmd.commandId);
  if (alreadySeen) {
    const snapshot = await loadLobbySnapshot(redis, cmd.gameId);
    if (snapshot) return { snapshot };
  }

  if (state.status !== "lobby") return { error: "GameAlreadyStarted" };
  const now = Date.now();
  if (deriveHostId(state, now) !== hostId) return { error: "NotHost" };

  const bag = createShuffledBag();
  const seq = await nextSeq(redis, cmd.gameId);
  const nextState: GameState = {
    ...state,
    status: "playing",
    seq,
    bankCount: bag.length,
    turnPlayerId: hostId,
    turnDeadline: now + state.config.turnTimerSec * 1000,
  };

  const multi = redis.multi();
  multi.set(stateKey(cmd.gameId), JSON.stringify(nextState));
  if (bag.length > 0) multi.rpush(bagKey(cmd.gameId), ...bag);
  await multi.exec();

  return { snapshot: toLobbySnapshot(cmd.gameId, nextState) };
}

/** Turns one tile. Delegates the actual verify+mutate to
 * apply_turn_tile.lua (packages/redis) for atomicity — see CLAUDE.md "Turn
 * timer enforcement" for why this one genuinely needs it, unlike startGame
 * above. */
export async function turnTile(
  redis: Redis,
  cmd: TurnTileCommand,
  playerId: string,
): Promise<{ snapshot: LobbySnapshot } | { error: TurnTileError }> {
  const result = await applyTurnTile(redis, {
    stateKey: stateKey(cmd.gameId),
    seqKey: seqKey(cmd.gameId),
    cmdsKey: cmdsKey(cmd.gameId),
    bagKey: bagKey(cmd.gameId),
    commandId: cmd.commandId,
    playerId,
    now: Date.now(),
    cmdsTtlSec: CMDS_TTL_SEC,
  });

  if ("error" in result) return { error: result.error };
  return { snapshot: toLobbySnapshot(cmd.gameId, result.state) };
}

export type EndGameError = "GameNotFound" | "GameNotStarted" | "GameNotIdle";

/** Ends the game once a client's local idle countdown says
 * `endGameDeadline` has passed. Delegates to apply_end_game.lua
 * (packages/redis) for the same atomicity reason as turnTile above — see
 * CLAUDE.md "Game-end condition". */
export async function endGame(
  redis: Redis,
  cmd: EndGameCommand,
): Promise<{ snapshot: LobbySnapshot } | { error: EndGameError }> {
  const result = await applyEndGame(redis, {
    stateKey: stateKey(cmd.gameId),
    seqKey: seqKey(cmd.gameId),
    cmdsKey: cmdsKey(cmd.gameId),
    commandId: cmd.commandId,
    now: Date.now(),
    cmdsTtlSec: CMDS_TTL_SEC,
  });

  if ("error" in result) return { error: result.error };
  return { snapshot: toLobbySnapshot(cmd.gameId, result.state) };
}

export type SubmitWordError = ApplySubmitWordError | WordPlayError;

export interface SubmitWordSuccess {
  snapshot: LobbySnapshot;
  word: string;
  usedWords: UsedWord[];
  usedPoolLetters: string[];
}

/** Any player, any time — see CLAUDE.md "Word resolution implementation
 * split". Node runs the full decomposition search (packages/game
 * resolveWordPlay) against a plain read, then hands the resolved plan to
 * apply_submit_word.lua (packages/redis) for the cheap atomic
 * re-verification and mutation — that script's own tests cover the
 * concurrent-race case this function just wires up. */
export async function submitWord(
  redis: Redis,
  cmd: SubmitWordCommand,
  playerId: string,
): Promise<SubmitWordSuccess | { error: SubmitWordError }> {
  const state = await loadGameState(redis, cmd.gameId);
  if (!state) return { error: "GameNotFound" };
  if (state.status !== "playing") return { error: "GameNotStarted" };

  const submitter = state.players.find((p) => p.id === playerId);
  if (!submitter) return { error: "PlayerNotFound" };

  const claimedWords: ClaimedWord[] = state.players.flatMap((p) =>
    p.words.map((word) => ({ word, ownerId: p.id })),
  );
  const scores = Object.fromEntries(state.players.map((p) => [p.id, p.score]));

  const resolved = resolveWordPlay({
    submittedWord: cmd.word,
    submitterId: playerId,
    pool: state.pool,
    claimedWords,
    scores,
    minWordLength: state.config.minWordLength,
  });
  if (!resolved.ok) return { error: resolved.error };

  // Stored/displayed uppercase, matching the pool's own casing (tiles are
  // drawn A-Z — packages/game/src/bag.ts) and the design prototype's
  // convention. resolveWordPlay itself is case-insensitive either way.
  const word = cmd.word.toUpperCase();

  const result = await applySubmitWord(redis, {
    stateKey: stateKey(cmd.gameId),
    seqKey: seqKey(cmd.gameId),
    cmdsKey: cmdsKey(cmd.gameId),
    commandId: cmd.commandId,
    submitterId: playerId,
    now: Date.now(),
    cmdsTtlSec: CMDS_TTL_SEC,
    word,
    usedWords: resolved.plan.usedWords,
    usedPoolLetters: resolved.plan.usedPoolLetters,
  });

  if ("error" in result) return { error: result.error };
  return {
    snapshot: toLobbySnapshot(cmd.gameId, result.state),
    word,
    usedWords: resolved.plan.usedWords,
    usedPoolLetters: resolved.plan.usedPoolLetters,
  };
}
