// Tile bag: which letters exist and in what quantity, and the shuffle that
// determines draw order. Distinct from (and supersedes for real gameplay)
// the smaller placeholder BAG constant in the design prototype
// (design-system/In Game.dc.html) — see CLAUDE.md "Design system" on that
// file being historical reference, not a build dependency.
//
// prettier-ignore
const LETTER_COUNTS: Record<string, number> = {
  A: 13, B: 3, C: 3, D: 6, E: 18, F: 3, G: 4, H: 3, I: 12, J: 2,
  K: 2, L: 5, M: 3, N: 8, O: 11, P: 3, Q: 2, R: 9, S: 6, T: 9,
  U: 6, V: 3, W: 3, X: 2, Y: 3, Z: 2,
};

export const LETTER_DISTRIBUTION = Object.entries(LETTER_COUNTS)
  .map(([letter, count]) => letter.repeat(count))
  .join("");

/** Fisher-Yates (Durstenfeld). `random` is injectable so callers/tests can
 * get a deterministic, reproducible order. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** The order tiles get drawn in for one game. Never sent to clients (that
 * would leak future draws) — kept server-side in its own Redis key, separate
 * from the public GameState.bankCount. See docs/redis-schema.md. */
export function createShuffledBag(random: () => number = Math.random): string[] {
  return shuffle(LETTER_DISTRIBUTION.split(""), random);
}
