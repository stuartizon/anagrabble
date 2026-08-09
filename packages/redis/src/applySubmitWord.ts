import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Redis } from "ioredis";
import type { GameState } from "@anagrabble/protocol";

const SCRIPT_PATH = fileURLToPath(new URL("./scripts/apply_submit_word.lua", import.meta.url));
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

export interface ApplySubmitWordKeys {
  stateKey: string;
  seqKey: string;
  cmdsKey: string;
}

export interface UsedWord {
  word: string;
  ownerId: string;
}

export interface ApplySubmitWordArgs extends ApplySubmitWordKeys {
  commandId: string;
  submitterId: string;
  now: number;
  cmdsTtlSec: number;
  /** Exact string to store in the submitter's `words` — same casing that
   * was validated against the dictionary. */
  word: string;
  /** Claimed words the resolved plan consumes, as read from state at
   * search time — see packages/game resolveWordPlay's `ResolvedWordPlay`. */
  usedWords: UsedWord[];
  /** Pool letters the resolved plan consumes, as read from state at search
   * time. */
  usedPoolLetters: string[];
}

export type ApplySubmitWordError =
  | "GameNotFound"
  | "GameNotStarted"
  | "PlayerNotFound"
  | "WordAlreadyClaimed"
  /** Referenced words/pool letters moved between the Node-side search and
   * this call — see CLAUDE.md "Word resolution implementation split".
   * Caller should re-run resolveWordPlay against fresh state and retry. */
  | "StaleState";

export type ApplySubmitWordResult = { state: GameState } | { error: ApplySubmitWordError };

/** Atomic re-verify + mutate for SubmitWord — see
 * packages/redis/src/scripts/apply_submit_word.lua for the actual logic and
 * CLAUDE.md "Word resolution implementation split" for why this needs to be
 * atomic. */
export async function applySubmitWord(
  redis: Redis,
  args: ApplySubmitWordArgs,
): Promise<ApplySubmitWordResult> {
  const raw = (await redis.eval(
    SCRIPT,
    3,
    args.stateKey,
    args.seqKey,
    args.cmdsKey,
    args.commandId,
    args.submitterId,
    String(args.now),
    String(args.cmdsTtlSec),
    args.word,
    JSON.stringify(args.usedWords),
    JSON.stringify(args.usedPoolLetters),
  )) as string;

  const parsed = JSON.parse(raw) as GameState | { error: ApplySubmitWordError };
  return "error" in parsed ? { error: parsed.error } : { state: parsed };
}
