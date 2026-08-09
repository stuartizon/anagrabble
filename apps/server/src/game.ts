import { applyTurnTile, type Redis } from "@anagrabble/redis";
import { createShuffledBag } from "@anagrabble/game";
import type {
  GameState,
  LobbySnapshot,
  StartGameCommand,
  TurnTileCommand,
} from "@anagrabble/protocol";
import {
  CMDS_TTL_SEC,
  bagKey,
  cmdsKey,
  loadGameState,
  loadLobbySnapshot,
  markCommandSeen,
  nextSeq,
  seqKey,
  stateKey,
  toLobbySnapshot,
  type LobbyError,
} from "./lobby.js";

export type StartGameError = LobbyError | "NotHost" | "NotEnoughPlayers";
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
): Promise<{ snapshot: LobbySnapshot } | { error: StartGameError }> {
  const state = await loadGameState(redis, cmd.gameId);
  if (!state) return { error: "GameNotFound" };

  const alreadySeen = await markCommandSeen(redis, cmd.gameId, cmd.commandId);
  if (alreadySeen) {
    const snapshot = await loadLobbySnapshot(redis, cmd.gameId);
    if (snapshot) return { snapshot };
  }

  if (state.status !== "lobby") return { error: "GameAlreadyStarted" };
  if (state.players[0]?.id !== cmd.hostId) return { error: "NotHost" };
  if (state.players.length < 2) return { error: "NotEnoughPlayers" };

  const bag = createShuffledBag();
  const now = Date.now();
  const seq = await nextSeq(redis, cmd.gameId);
  const nextState: GameState = {
    ...state,
    status: "playing",
    seq,
    bankCount: bag.length,
    turnPlayerIndex: 0,
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
): Promise<{ snapshot: LobbySnapshot } | { error: TurnTileError }> {
  const result = await applyTurnTile(redis, {
    stateKey: stateKey(cmd.gameId),
    seqKey: seqKey(cmd.gameId),
    cmdsKey: cmdsKey(cmd.gameId),
    bagKey: bagKey(cmd.gameId),
    commandId: cmd.commandId,
    playerId: cmd.playerId,
    now: Date.now(),
    cmdsTtlSec: CMDS_TTL_SEC,
  });

  if ("error" in result) return { error: result.error };
  return { snapshot: toLobbySnapshot(cmd.gameId, result.state) };
}
