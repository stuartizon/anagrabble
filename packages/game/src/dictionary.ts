// Loaded once in-memory from data/dictionary.csv (see CLAUDE.md "Still open" ->
// dictionary source, now resolved: flat file, pre-flattened root chains).
// Source/provenance: packages/game/data/dictionary-source.csv, see
// scripts/build-dictionary.mjs and docs/decisions.md "Dictionary source".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const dictionaryPath = path.join(dir, "..", "data", "dictionary.csv");

/** word -> ultimate root, absent when the word has no recorded root. */
const roots = new Map<string, string>();

for (const line of readFileSync(dictionaryPath, "utf8").split("\n")) {
  if (!line) continue;
  const [word, root] = line.split(",");
  roots.set(word, root ?? "");
}

export function isWord(word: string): boolean {
  return roots.has(word.toLowerCase());
}

export function rootOf(word: string): string | undefined {
  const root = roots.get(word.toLowerCase());
  return root ? root : undefined;
}

/**
 * True when `word` is a recorded derivation of `base` (e.g. ABATED is
 * derived from ABATE, transitively flattened at build time).
 * Per CLAUDE.md "Word formability": extending your own claimed word this way
 * is not a legal play, even though it's letter-formable from base + pool.
 */
export function isDerivedFrom(word: string, base: string): boolean {
  return rootOf(word) === base.toLowerCase();
}
