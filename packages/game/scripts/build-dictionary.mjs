#!/usr/bin/env node
// Flattens data/dictionary-source.csv (word -> immediate parent, one hop) into
// data/dictionary.csv (word -> ultimate root, chain already walked). Doing this
// once at build time means the game-time steal check is a single lookup instead
// of a chain walk. Re-run this whenever dictionary-source.csv is updated.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(dir, "..", "data", "dictionary-source.csv");
const outPath = path.join(dir, "..", "data", "dictionary.csv");

const lines = readFileSync(sourcePath, "utf8").split("\n").filter(Boolean);

/** @type {Map<string, string>} word -> immediate parent (or "" if none) */
const parent = new Map();
for (const line of lines) {
  const [word, root = ""] = line.split(",");
  parent.set(word, root);
}

/** @type {Map<string, string>} word -> ultimate root (memoized) */
const ultimate = new Map();
// Source data should never contain a root cycle (A -> B -> A) - it's
// structurally impossible for a genuine derivation chain, since each hop
// must add material. One slipped through 2026-08-12 (see docs/decisions.md
// "Root-word enrichment: WordNet + Wiktionary") when a newly-filled correct
// root combined with a pre-existing backwards entry; this bailed out
// silently instead of failing loudly. Collected here so a future rerun
// can't reintroduce the same silent failure mode.
const cycleWords = [];

function resolveUltimateRoot(word) {
  if (ultimate.has(word)) return ultimate.get(word);

  const seen = new Set();
  let current = word;
  while (true) {
    const next = parent.get(current);
    if (!next) break; // no further root recorded
    if (seen.has(next)) {
      cycleWords.push(word);
      break; // cycle in source data, bail out where we are
    }
    seen.add(current);
    current = next;
  }

  const root = current === word ? "" : current;
  ultimate.set(word, root);
  return root;
}

const out = [];
for (const word of parent.keys()) {
  const root = resolveUltimateRoot(word);
  out.push(root ? `${word},${root}` : word);
}

writeFileSync(outPath, out.join("\n") + "\n");
console.log(`Wrote ${out.length} words to ${path.relative(process.cwd(), outPath)}`);
if (cycleWords.length > 0) {
  console.warn(
    `WARNING: ${cycleWords.length} word(s) hit a root cycle in dictionary-source.csv ` +
      `and resolved to an arbitrary point in the loop, not a real ultimate root: ` +
      `${cycleWords.join(", ")}. Fix the source data (a root cycle means at least one ` +
      `recorded root is backwards) and re-run.`,
  );
}
