// TDD for the tile bag: see CLAUDE.md "Game rules". The letter distribution
// itself is a fixed design decision (packages/game/src/bag.ts); these tests
// cover the shuffle mechanics and that the bag contains exactly that set.

import { describe, expect, it } from "vitest";
import { LETTER_DISTRIBUTION, createShuffledBag, shuffle } from "./bag.js";

describe("shuffle", () => {
  it("performs a Fisher-Yates shuffle given the injected random source", () => {
    // random() always 0 -> every swap target index is 0, a fully determined
    // trace: [1,2,3,4] -> [4,2,3,1] -> [3,2,4,1] -> [2,3,4,1]
    const result = shuffle([1, 2, 3, 4], () => 0);
    expect(result).toEqual([2, 3, 4, 1]);
  });

  it("never swaps out of bounds at the top of the range", () => {
    // random() just under 1 -> every swap target index is the current index
    // itself (a no-op swap). Guards against the classic off-by-one where
    // random() * length (instead of * (i + 1)) reads one past the array.
    const result = shuffle([1, 2, 3, 4], () => 0.999999);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it("does not mutate the input array", () => {
    const input = [1, 2, 3];
    shuffle(input, () => 0);
    expect(input).toEqual([1, 2, 3]);
  });
});

describe("createShuffledBag", () => {
  it("contains exactly the documented letter distribution", () => {
    const bag = createShuffledBag(() => 0);
    expect(bag.length).toBe(LETTER_DISTRIBUTION.length);
    expect(bag.slice().sort().join("")).toBe(LETTER_DISTRIBUTION.split("").sort().join(""));
  });
});
