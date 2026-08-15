import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Redis } from "ioredis";
import type { GameState } from "@anagrabble/protocol";

const SCRIPT_PATH = fileURLToPath(new URL("./scripts/apply_presence.lua", import.meta.url));
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

export interface ApplyPresenceArgs {
  stateKey: string;
  playerId: string;
  lastSeenAt: number;
}

export type ApplyPresenceError = "GameNotFound";
export type ApplyPresenceResult = { state: GameState } | { error: ApplyPresenceError };

/** Atomic per-player `lastSeenAt` write — see
 * packages/redis/src/scripts/apply_presence.lua for the actual logic and
 * docs/decisions.md "Player presence: connected/disconnected/left tracking"
 * for why this needs to be atomic (a plain GET/SET could clobber a
 * concurrent gameplay mutation to the same state blob). */
export async function applyPresence(
  redis: Redis,
  args: ApplyPresenceArgs,
): Promise<ApplyPresenceResult> {
  const raw = (await redis.eval(
    SCRIPT,
    1,
    args.stateKey,
    args.playerId,
    String(args.lastSeenAt),
  )) as string;

  const parsed = JSON.parse(raw) as GameState | { error: ApplyPresenceError };
  return "error" in parsed ? { error: parsed.error } : { state: parsed };
}
