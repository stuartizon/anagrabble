// Property-based tests for resolveWordPlay — see CLAUDE.md "Testing strategy":
// fast-check over hand-written cases for the decomposition search, since it's
// "highest bug-risk, easiest-to-test." Generators sample real dictionary
// content (arbitrary letter strings are essentially never real words, so
// randomizing over *state* — pool noise, claimed-word noise, ownership,
// min length — while sampling *words* from the real dictionary is what
// actually exercises the search).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isDerivedFrom } from "./dictionary.js";
import { resolveWordPlay, type ClaimedWord, type ResolveWordPlayInput } from "./resolution.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const dictionaryPath = path.join(dir, "..", "data", "dictionary.csv");

function letterCounts(word: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of word.toLowerCase()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return counts;
}

function isSubMultiset(sub: Map<string, number>, of: Map<string, number>): boolean {
  for (const [letter, count] of sub) {
    if ((of.get(letter) ?? 0) < count) return false;
  }
  return true;
}

// A spread sample (every 50th qualifying entry, not just the start of the
// alphabetical file) of short-ish real words, split into words with no
// recorded root and genuine (root's letters are a sub-multiset of the
// word's) derivation pairs. ~1300 / ~970 entries — plenty for fast-check,
// cheap to build once at module load.
const rootlessWords: string[] = [];
const derivedPairs: { word: string; root: string }[] = [];
let stride = 0;
for (const line of readFileSync(dictionaryPath, "utf8").split("\n")) {
  if (!line) continue;
  const [word, root] = line.split(",");
  if (word.length < 3 || word.length > 8) continue;
  stride++;
  if (stride % 50 !== 0) continue;
  if (root) {
    if (isSubMultiset(letterCounts(root), letterCounts(word))) derivedPairs.push({ word, root });
  } else {
    rootlessWords.push(word);
  }
}

const ownerArb = fc.constantFrom("p1", "p2", "p3");
const noiseLettersArb = fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
  maxLength: 6,
});
const noiseClaimedWordArb: fc.Arbitrary<ClaimedWord> = fc.record({
  word: fc.constantFrom(...rootlessWords),
  ownerId: ownerArb,
});
// A real rootless word paired with a minWordLength guaranteed <= its length,
// so "submit the word using only its own letters as the pool" always clears
// both the length and dictionary checks.
const wordAndMinLengthArb = fc.constantFrom(...rootlessWords).chain((word) =>
  fc.record({
    word: fc.constant(word),
    minWordLength: fc.integer({ min: 3, max: Math.min(word.length, 5) }),
  }),
);

function buildInput(
  word: string,
  minWordLength: number,
  noiseLetters: string[],
  noiseClaimedWords: ClaimedWord[],
  submitterId: string,
): ResolveWordPlayInput {
  return {
    submittedWord: word,
    submitterId,
    pool: [...word.split(""), ...noiseLetters],
    claimedWords: noiseClaimedWords,
    scores: {},
    minWordLength,
  };
}

describe("resolveWordPlay: property-based invariants", () => {
  it(
    "always conserves letters exactly, never fabricates words/letters, " +
      "never bare-resubmits, and never lets a derivation through — no matter what noise is added",
    () => {
      fc.assert(
        fc.property(
          wordAndMinLengthArb,
          noiseLettersArb,
          fc.array(noiseClaimedWordArb, { maxLength: 3 }),
          ownerArb,
          ({ word, minWordLength }, noiseLetters, noiseClaimedWords, submitterId) => {
            const input = buildInput(
              word,
              minWordLength,
              noiseLetters,
              noiseClaimedWords,
              submitterId,
            );
            const result = resolveWordPlay(input);

            // Pool-only is always available by construction (pool contains
            // the word's own letters), regardless of whatever noise claimed
            // words/letters got thrown in alongside it.
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const { usedWords, usedPoolLetters } = result.plan;

            for (const used of usedWords) {
              expect(noiseClaimedWords).toContainEqual(used);
            }

            const poolRemaining = [...input.pool];
            for (const letter of usedPoolLetters) {
              const index = poolRemaining.findIndex(
                (tile) => tile.toLowerCase() === letter.toLowerCase(),
              );
              expect(index).toBeGreaterThanOrEqual(0);
              poolRemaining.splice(index, 1);
            }

            const composed = usedWords
              .map((w) => w.word)
              .join("")
              .concat(usedPoolLetters.join(""))
              .toLowerCase()
              .split("")
              .sort();
            expect(composed).toEqual(word.toLowerCase().split("").sort());

            if (usedWords.length === 1) {
              expect(usedPoolLetters.length).toBeGreaterThan(0);
            }

            for (const used of usedWords) {
              expect(isDerivedFrom(word, used.word)).toBe(false);
            }
          },
        ),
        { numRuns: 300 },
      );
    },
  );

  it("returns an identical result when called twice with the same input", () => {
    fc.assert(
      fc.property(
        wordAndMinLengthArb,
        noiseLettersArb,
        fc.array(noiseClaimedWordArb, { maxLength: 3 }),
        ownerArb,
        ({ word, minWordLength }, noiseLetters, noiseClaimedWords, submitterId) => {
          const input = buildInput(
            word,
            minWordLength,
            noiseLetters,
            noiseClaimedWords,
            submitterId,
          );
          expect(resolveWordPlay(input)).toEqual(resolveWordPlay(input));
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("resolveWordPlay: derivation always blocks the steal", () => {
  it("never resolves a word into a decomposition of just its recorded root plus extra letters", () => {
    fc.assert(
      fc.property(fc.constantFrom(...derivedPairs), ({ word, root }) => {
        const claimedWords: ClaimedWord[] = [{ word: root, ownerId: "opponent" }];

        // Pool = word's letters minus root's letters. Since root's letters
        // are a genuine sub-multiset of word's (filtered at fixture-build
        // time above), this pool always has strictly fewer letters than the
        // full word, so pool-only formation is mathematically impossible —
        // the *only* letter-complete decomposition is root + these extras,
        // which isDerivedFrom must block.
        const remaining = new Map(letterCounts(root));
        const pool: string[] = [];
        for (const ch of word.toLowerCase()) {
          const left = remaining.get(ch) ?? 0;
          if (left > 0) remaining.set(ch, left - 1);
          else pool.push(ch);
        }

        const result = resolveWordPlay({
          submittedWord: word,
          submitterId: "me",
          pool,
          claimedWords,
          scores: {},
          minWordLength: 3,
        });

        // Not NoDecomposition: this construction guarantees a genuinely
        // letter-valid, non-bare decomposition existed (root's letters are a
        // strict sub-multiset of word's, per the fixture filter above) — it
        // was rejected specifically for being a derivation, which is exactly
        // what DerivationBlocked means to distinguish.
        expect(result).toEqual({ ok: false, error: "DerivationBlocked" });
      }),
      { numRuns: 300 },
    );
  });
});
