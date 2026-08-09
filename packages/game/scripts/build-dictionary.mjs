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

function resolveUltimateRoot(word) {
  if (ultimate.has(word)) return ultimate.get(word);

  const seen = new Set();
  let current = word;
  while (true) {
    const next = parent.get(current);
    if (!next) break; // no further root recorded
    if (seen.has(next)) break; // cycle in source data, bail out where we are
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
