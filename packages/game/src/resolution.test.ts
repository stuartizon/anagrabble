// TDD for word-play resolution: see CLAUDE.md "Word formability" and "Word
// resolution implementation split". This is the TypeScript decomposition
// search — step 1 of that split (Node reads state, searches, produces a
// resolved plan). The Lua re-verification step is separate (packages/redis).
//
// Fixtures below are checked against the real dictionary
// (packages/game/data/dictionary.csv), not invented:
//   cat (no root), cats -> cat, cast (no root) — CLAUDE.md's own CAT+S=CAST
//   example, plus CATS as the blocked "just pluralized it" sibling.
//   cat + nap -> catnap (no root on any of the three) — genuine 2-word combine.
//   teak (no root), seat (no root), steak (no root) — two different single-word
//   bases that both extend into the same target, for the tiebreak case.

import { describe, expect, it } from "vitest";
import { resolveWordPlay, type ClaimedWord } from "./resolution.js";

const minWordLength = 3;

describe("resolveWordPlay: input validation", () => {
  it("rejects words shorter than minWordLength", () => {
    const result = resolveWordPlay({
      submittedWord: "at",
      submitterId: "p1",
      pool: ["a", "t"],
      claimedWords: [],
      scores: {},
      minWordLength,
    });
    expect(result).toEqual({ ok: false, error: "TooShort" });
  });

  it("rejects words not in the dictionary", () => {
    const result = resolveWordPlay({
      submittedWord: "zzzzx",
      submitterId: "p1",
      pool: ["z", "z", "z", "z", "x"],
      claimedWords: [],
      scores: {},
      minWordLength,
    });
    expect(result).toEqual({ ok: false, error: "NotAWord" });
  });
});

describe("resolveWordPlay: pool-only", () => {
  it("forms a word directly from pool letters with no claimed words involved", () => {
    const result = resolveWordPlay({
      submittedWord: "cat",
      submitterId: "p1",
      pool: ["c", "a", "t"],
      claimedWords: [],
      scores: {},
      minWordLength,
    });
    expect(result).toEqual({
      ok: true,
      plan: { usedWords: [], usedPoolLetters: ["c", "a", "t"] },
    });
  });

  it("fails when the pool doesn't have enough of a letter", () => {
    const result = resolveWordPlay({
      submittedWord: "cat",
      submitterId: "p1",
      pool: ["c", "a"],
      claimedWords: [],
      scores: {},
      minWordLength,
    });
    expect(result).toEqual({ ok: false, error: "NoDecomposition" });
  });
});

describe("resolveWordPlay: single-word steal/extend", () => {
  const catOwnedByP2: ClaimedWord = { word: "cat", ownerId: "p2" };

  it("steals CAT into CAST with one pool letter (CLAUDE.md's own example)", () => {
    const result = resolveWordPlay({
      submittedWord: "cast",
      submitterId: "p1",
      pool: ["s"],
      claimedWords: [catOwnedByP2],
      scores: {},
      minWordLength,
    });
    expect(result).toEqual({
      ok: true,
      plan: { usedWords: [catOwnedByP2], usedPoolLetters: ["s"] },
    });
  });

  it("blocks a bare resubmission of a claimed word with zero additions", () => {
    const castOwnedByP2: ClaimedWord = { word: "cast", ownerId: "p2" };
    const result = resolveWordPlay({
      submittedWord: "cast",
      submitterId: "p1",
      pool: ["z"], // present so the pool isn't trivially empty, but useless here
      claimedWords: [castOwnedByP2],
      scores: {},
      minWordLength,
    });
    expect(result).toEqual({ ok: false, error: "NoDecomposition" });
  });

  it("blocks stealing a word into its recorded dictionary derivation (CAT -> CATS)", () => {
    const result = resolveWordPlay({
      submittedWord: "cats",
      submitterId: "p1",
      pool: ["s"],
      claimedWords: [catOwnedByP2],
      scores: {},
      minWordLength,
    });
    expect(result).toEqual({ ok: false, error: "NoDecomposition" });
  });

  it("lets a player extend their own claimed word", () => {
    const catOwnedByP1: ClaimedWord = { word: "cat", ownerId: "p1" };
    const result = resolveWordPlay({
      submittedWord: "cast",
      submitterId: "p1",
      pool: ["s"],
      claimedWords: [catOwnedByP1],
      scores: {},
      minWordLength,
    });
    expect(result).toEqual({
      ok: true,
      plan: { usedWords: [catOwnedByP1], usedPoolLetters: ["s"] },
    });
  });
});

describe("resolveWordPlay: combining multiple claimed words", () => {
  it("combines two of the submitter's own claimed words with no pool letters needed", () => {
    const cat: ClaimedWord = { word: "cat", ownerId: "p1" };
    const nap: ClaimedWord = { word: "nap", ownerId: "p1" };
    const result = resolveWordPlay({
      submittedWord: "catnap",
      submitterId: "p1",
      pool: [],
      claimedWords: [cat, nap],
      scores: {},
      minWordLength,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.usedWords).toEqual(expect.arrayContaining([cat, nap]));
      expect(result.plan.usedPoolLetters).toEqual([]);
    }
  });

  it("counts a combine involving any opponent's word as a steal", () => {
    const cat: ClaimedWord = { word: "cat", ownerId: "p1" };
    const nap: ClaimedWord = { word: "nap", ownerId: "p2" };
    const result = resolveWordPlay({
      submittedWord: "catnap",
      submitterId: "p1",
      pool: [],
      claimedWords: [cat, nap],
      scores: {},
      minWordLength,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.usedWords).toEqual(expect.arrayContaining([cat, nap]));
    }
  });
});

describe("resolveWordPlay: priority ordering", () => {
  it("prefers a steal over an equally-available pool-only formation", () => {
    const catOwnedByP2: ClaimedWord = { word: "cat", ownerId: "p2" };
    const result = resolveWordPlay({
      submittedWord: "cast",
      submitterId: "p1",
      // enough in the pool to form "cast" outright, pool-only
      pool: ["c", "a", "s", "t"],
      claimedWords: [catOwnedByP2],
      scores: {},
      minWordLength,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.usedWords).toEqual([catOwnedByP2]);
    }
  });

  it("prefers a steal over extending only the submitter's own word", () => {
    // "tea" (p1's own) extends into "steak" with pool s+k (tier 3); "teak"
    // (p2's) extends into "steak" with just pool s (tier 1) — both coexist,
    // steal must win.
    const teaOwnedByP1: ClaimedWord = { word: "tea", ownerId: "p1" };
    const teakOwnedByP2: ClaimedWord = { word: "teak", ownerId: "p2" };
    const result = resolveWordPlay({
      submittedWord: "steak",
      submitterId: "p1",
      pool: ["s", "k"],
      claimedWords: [teaOwnedByP1, teakOwnedByP2],
      scores: {},
      minWordLength,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.usedWords).toEqual([teakOwnedByP2]);
    }
  });
});

describe("resolveWordPlay: tiebreak within the steal tier", () => {
  it("steals from the highest-scoring opponent when multiple opponents are stealable", () => {
    const teakOwnedByLowScorer: ClaimedWord = { word: "teak", ownerId: "low" };
    const seatOwnedByHighScorer: ClaimedWord = { word: "seat", ownerId: "high" };
    const result = resolveWordPlay({
      submittedWord: "steak",
      submitterId: "p1",
      pool: ["s", "k"],
      claimedWords: [teakOwnedByLowScorer, seatOwnedByHighScorer],
      scores: { low: 5, high: 50 },
      minWordLength,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.usedWords).toEqual([seatOwnedByHighScorer]);
    }
  });
});
