// Domain logic: word resolution, steal rules, dictionary validation.
// See CLAUDE.md "Word formability" and "Word resolution implementation split" —
// the combinatorial decomposition search lives here in TypeScript, not in Lua.

import type { GameConfig } from "@anagrabble/protocol";

export type { GameConfig };
export { LETTER_DISTRIBUTION, createShuffledBag, shuffle } from "./bag.js";
export { isDerivedFrom, isWord, rootOf } from "./dictionary.js";
export { resolveWordPlay } from "./resolution.js";
export type {
  ClaimedWord,
  ResolvedWordPlay,
  ResolveWordPlayInput,
  ResolveWordPlayResult,
  WordPlayError,
} from "./resolution.js";

export const DEFAULT_GAME_CONFIG: GameConfig = {
  turnTimerSec: 30,
  minWordLength: 3,
  language: "en",
};
