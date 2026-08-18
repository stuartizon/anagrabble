import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Redis } from "./client.js";
import type { GameState } from "@anagrabble/protocol";

const SCRIPT_PATH = fileURLToPath(new URL("./scripts/apply_end_game.lua", import.meta.url));
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

export interface ApplyEndGameKeys {
  stateKey: string;
  seqKey: string;
  cmdsKey: string;
}

export interface ApplyEndGameArgs extends ApplyEndGameKeys {
  commandId: string;
  now: number;
  cmdsTtlSec: number;
}

export type ApplyEndGameError = "GameNotFound" | "GameNotStarted" | "GameNotIdle";
export type ApplyEndGameResult = { state: GameState } | { error: ApplyEndGameError };

/** Atomic verify + mutate for EndGame — see
 * packages/redis/src/scripts/apply_end_game.lua for the actual logic and
 * CLAUDE.md "Game-end condition" for why the deadline check needs to be
 * server-verified rather than trusted to the client. */
export async function applyEndGame(
  redis: Redis,
  args: ApplyEndGameArgs,
): Promise<ApplyEndGameResult> {
  const raw = (await redis.eval(SCRIPT, {
    keys: [args.stateKey, args.seqKey, args.cmdsKey],
    arguments: [args.commandId, String(args.now), String(args.cmdsTtlSec)],
  })) as string;

  const parsed = JSON.parse(raw) as GameState | { error: ApplyEndGameError };
  return "error" in parsed ? { error: parsed.error } : { state: parsed };
}
