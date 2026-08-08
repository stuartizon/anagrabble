// Domain logic: word resolution, steal rules, dictionary validation.
// See CLAUDE.md "Word formability" and "Word resolution implementation split" —
// the combinatorial decomposition search lives here in TypeScript, not in Lua.

export interface GameConfig {
  turnTimerSec: number;
  minWordLength: number;
  language: string;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  turnTimerSec: 30,
  minWordLength: 3,
  language: "en",
};
