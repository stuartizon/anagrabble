import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Redis } from "./client.js";
import type { GameState } from "@anagrabble/protocol";

const SCRIPT_PATH = fileURLToPath(new URL("./scripts/apply_turn_tile.lua", import.meta.url));
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

export interface ApplyTurnTileKeys {
  stateKey: string;
  seqKey: string;
  cmdsKey: string;
  bagKey: string;
}

export interface ApplyTurnTileArgs extends ApplyTurnTileKeys {
  commandId: string;
  playerId: string;
  now: number;
  cmdsTtlSec: number;
  /** See TurnTileCommand in @anagrabble/protocol — omitted (undefined/null)
   * for a manual current-player click, which should always succeed. */
  observedTurnDeadline?: number | null;
  /** apps/server/src/lobby.ts's PRESENCE_STALE_MS — passed in rather than
   * duplicated as a Lua literal, since Redis's sandboxed Lua can't read a
   * config file or env var itself. */
  presenceStaleMs: number;
}

export type ApplyTurnTileError = "GameNotFound" | "GameNotStarted" | "NotYourTurn";
export type ApplyTurnTileResult = { state: GameState } | { error: ApplyTurnTileError };

/** Atomic verify + mutate for TurnTile — see
 * packages/redis/src/scripts/apply_turn_tile.lua for the actual logic and
 * CLAUDE.md "Turn timer enforcement" for why this needs to be atomic. */
export async function applyTurnTile(
  redis: Redis,
  args: ApplyTurnTileArgs,
): Promise<ApplyTurnTileResult> {
  const raw = (await redis.eval(SCRIPT, {
    keys: [args.stateKey, args.seqKey, args.cmdsKey, args.bagKey],
    arguments: [
      args.commandId,
      args.playerId,
      String(args.now),
      String(args.cmdsTtlSec),
      args.observedTurnDeadline != null ? String(args.observedTurnDeadline) : "",
      String(args.presenceStaleMs),
    ],
  })) as string;

  const parsed = JSON.parse(raw) as GameState | { error: ApplyTurnTileError };
  return "error" in parsed ? { error: parsed.error } : { state: parsed };
}
