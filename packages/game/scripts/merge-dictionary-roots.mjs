#!/usr/bin/env node
// Applies data/generated/wordnet-roots.csv and then
// data/generated/wiktionary-roots.csv (in that priority order) to
// data/dictionary-source.csv, filling only currently-blank roots - never
// overwriting existing data. Run scripts/fetch-wordnet-roots.mjs and
// scripts/fetch-wiktionary-roots.mjs first (or just `pnpm enrich:dictionary`,
// which runs the whole pipeline including this and the existing
// build:dictionary flattening step). See scripts/lib/merge-roots.mjs for the
// tested merge logic this wires up to real files.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mergeDictionaryRoots } from "./lib/merge-roots.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(dir, "..", "data", "dictionary-source.csv");
const wordnetPath = path.join(dir, "..", "data", "generated", "wordnet-roots.csv");
const wiktionaryPath = path.join(dir, "..", "data", "generated", "wiktionary-roots.csv");

function readRows(filePath) {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [word, root = ""] = line.split(",");
      return [word, root];
    });
}

const existingRows = readRows(sourcePath);
const wordnetLayer = readRows(wordnetPath);
const wiktionaryLayer = readRows(wiktionaryPath);

const { rows, filledPerLayer, skippedInvalid } = mergeDictionaryRoots(existingRows, [
  wordnetLayer,
  wiktionaryLayer,
]);

// Preserve the source file's existing convention of a trailing comma for a
// blank root (e.g. "aa,") rather than a bare word, so a rerun that fills
// nothing produces a clean, empty diff instead of touching every line.
writeFileSync(sourcePath, rows.map(([word, root]) => `${word},${root}`).join("\n") + "\n");

console.log(`Filled ${filledPerLayer[0]} roots from WordNet, ${filledPerLayer[1]} from Wiktionary`);
console.log(
  `Skipped ${skippedInvalid} candidates that failed validation (root not itself a dictionary word, or not a valid prefix)`,
);
console.log(
  `Updated ${path.relative(process.cwd(), sourcePath)} - review the diff, then run \`pnpm build:dictionary\``,
);
