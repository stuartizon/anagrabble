// The decomposition search — see CLAUDE.md "Word formability" and "Word
// resolution implementation split". This is step 1 of that split: given a
// plain read of current state, find every letter-valid way to form the
// submitted word from claimed words + pool letters, apply the priority and
// tiebreak rules, and produce a concrete resolved plan. Step 2 (atomic
// re-verification + mutation) is a Lua script in packages/redis, not here.

import { isDerivedFrom, isWord } from "./dictionary.js";

export interface ClaimedWord {
  word: string;
  ownerId: string;
}

export interface ResolveWordPlayInput {
  submittedWord: string;
  submitterId: string;
  /** Currently revealed, unclaimed pool letters. */
  pool: string[];
  claimedWords: ClaimedWord[];
  /** playerId -> score, used for the highest-scorer steal tiebreak. */
  scores: Record<string, number>;
  minWordLength: number;
}

export interface ResolvedWordPlay {
  usedWords: ClaimedWord[];
  usedPoolLetters: string[];
}

export type WordPlayError = "TooShort" | "NotAWord" | "NoDecomposition";

export type ResolveWordPlayResult =
  { ok: true; plan: ResolvedWordPlay } | { ok: false; error: WordPlayError };

type LetterCounts = Map<string, number>;

function letterCounts(letters: Iterable<string>): LetterCounts {
  const counts: LetterCounts = new Map();
  for (const raw of letters) {
    const letter = raw.toLowerCase();
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  return counts;
}

function isSubMultiset(sub: LetterCounts, of: LetterCounts): boolean {
  for (const [letter, count] of sub) {
    if ((of.get(letter) ?? 0) < count) return false;
  }
  return true;
}

function subtract(from: LetterCounts, minus: LetterCounts): LetterCounts {
  const result = new Map(from);
  for (const [letter, count] of minus) {
    const remaining = (result.get(letter) ?? 0) - count;
    if (remaining > 0) result.set(letter, remaining);
    else result.delete(letter);
  }
  return result;
}

function totalCount(counts: LetterCounts): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

interface Candidate {
  usedWords: ClaimedWord[];
  usedPoolLetters: string[];
}

/** All subsets of `items`, smallest first. Only ever called on the
 * letter-compatible subset of claimed words (see findCandidates), which in
 * practice is small — a full power set here is fine for that size. */
function* subsetsOf<T>(items: T[]): Generator<T[]> {
  const n = items.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const subset: T[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(items[i]);
    }
    yield subset;
  }
}

/** Picks `remaining`'s letters out of the actual pool array, preserving
 * whatever casing the caller's pool entries used. Which specific duplicate
 * tile is picked doesn't matter — tiles of the same letter are fungible. */
function selectPoolLetters(pool: string[], remaining: LetterCounts): string[] {
  const need = new Map(remaining);
  const selected: string[] = [];
  for (const tile of pool) {
    const letter = tile.toLowerCase();
    const left = need.get(letter) ?? 0;
    if (left > 0) {
      selected.push(tile);
      need.set(letter, left - 1);
    }
  }
  return selected;
}

function findCandidates(
  submittedWord: string,
  targetLetters: LetterCounts,
  poolLetters: LetterCounts,
  pool: string[],
  claimedWords: ClaimedWord[],
): Candidate[] {
  // Only claimed words letter-compatible with the target can possibly
  // participate — this is the prune that keeps the subset search small.
  const relevant = claimedWords.filter((w) => isSubMultiset(letterCounts(w.word), targetLetters));

  const candidates: Candidate[] = [];
  for (const subset of subsetsOf(relevant)) {
    const usedLetters = subset.reduce((acc, w) => {
      for (const [letter, count] of letterCounts(w.word)) {
        acc.set(letter, (acc.get(letter) ?? 0) + count);
      }
      return acc;
    }, new Map<string, number>() as LetterCounts);
    if (!isSubMultiset(usedLetters, targetLetters)) continue;

    const remaining = subtract(targetLetters, usedLetters);
    if (!isSubMultiset(remaining, poolLetters)) continue;

    // "A single word reused with zero additions is invalid" (CLAUDE.md).
    if (subset.length === 1 && totalCount(remaining) === 0) continue;

    // Derivation blocks a steal/extend no matter how the rest of the
    // letters were sourced — see CLAUDE.md "Derivation is not a legal steal".
    if (subset.some((w) => isDerivedFrom(submittedWord, w.word))) continue;

    candidates.push({ usedWords: subset, usedPoolLetters: selectPoolLetters(pool, remaining) });
  }

  return candidates;
}

/** CLAUDE.md priority tiers: (1) steals from another player, (2) pool-only,
 * (3) extending only the submitter's own word(s). Lower number = higher
 * priority. */
function tierOf(candidate: Candidate, submitterId: string): 1 | 2 | 3 {
  if (candidate.usedWords.length === 0) return 2;
  if (candidate.usedWords.some((w) => w.ownerId !== submitterId)) return 1;
  return 3;
}

function highestOpponentScore(
  candidate: Candidate,
  submitterId: string,
  scores: Record<string, number>,
): number {
  const opponentScores = candidate.usedWords
    .filter((w) => w.ownerId !== submitterId)
    .map((w) => scores[w.ownerId] ?? 0);
  return Math.max(...opponentScores);
}

function pickBest(
  candidates: Candidate[],
  submitterId: string,
  scores: Record<string, number>,
): ResolvedWordPlay {
  const bestTier = Math.min(...candidates.map((c) => tierOf(c, submitterId)));
  const tierCandidates = candidates.filter((c) => tierOf(c, submitterId) === bestTier);

  const winner =
    bestTier === 1
      ? tierCandidates.reduce((best, c) =>
          highestOpponentScore(c, submitterId, scores) >
          highestOpponentScore(best, submitterId, scores)
            ? c
            : best,
        )
      : tierCandidates[0];

  return { usedWords: winner.usedWords, usedPoolLetters: winner.usedPoolLetters };
}

export function resolveWordPlay(input: ResolveWordPlayInput): ResolveWordPlayResult {
  const word = input.submittedWord.toLowerCase();
  if (word.length < input.minWordLength) return { ok: false, error: "TooShort" };
  if (!isWord(word)) return { ok: false, error: "NotAWord" };

  const targetLetters = letterCounts(word);
  const poolLetters = letterCounts(input.pool);

  const candidates = findCandidates(
    word,
    targetLetters,
    poolLetters,
    input.pool,
    input.claimedWords,
  );
  if (candidates.length === 0) return { ok: false, error: "NoDecomposition" };

  return { ok: true, plan: pickBest(candidates, input.submitterId, input.scores) };
}
