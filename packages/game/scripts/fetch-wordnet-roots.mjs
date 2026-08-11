#!/usr/bin/env node
// Downloads Princeton WordNet 3.0 (permissive license: see
// https://wordnetcode.princeton.edu/3.0/LICENSE), extracts its
// derivationally-related-form ("+") pointers, and writes a candidate
// (word, root) CSV to data/generated/wordnet-roots.csv. Re-run any time
// (pnpm fetch:wordnet-roots) - it's the first, safe layer of
// scripts/merge-dictionary-roots.mjs. See docs/decisions.md "Dictionary
// source and format" for why this exists and scripts/lib/wordnet-parse.mjs
// for the tested parsing logic this just wires up to real files.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractDerivationalLemmaPairs, rootsFromLemmaPairs } from "./lib/wordnet-parse.mjs";

const WORDNET_URL = "https://wordnetcode.princeton.edu/3.0/WNdb-3.0.tar.gz";

const dir = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(dir, "..", "data", ".cache");
const tarballPath = path.join(cacheDir, "WNdb-3.0.tar.gz");
const extractDir = path.join(cacheDir, "wordnet");
const outPath = path.join(dir, "..", "data", "generated", "wordnet-roots.csv");

const force = process.argv.includes("--force");

mkdirSync(cacheDir, { recursive: true });

if (force || !existsSync(tarballPath)) {
  console.log(`Downloading ${WORDNET_URL} ...`);
  const response = await fetch(WORDNET_URL);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(tarballPath, buffer);
  console.log(`Saved ${buffer.length} bytes to ${path.relative(process.cwd(), tarballPath)}`);
} else {
  console.log(
    `Using cached ${path.relative(process.cwd(), tarballPath)} (pass --force to re-download)`,
  );
}

if (force || !existsSync(path.join(extractDir, "dict", "data.noun"))) {
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["xzf", tarballPath, "-C", extractDir]);
}

const dictDir = path.join(extractDir, "dict");
const dataFilesByPos = {
  n: readFileSync(path.join(dictDir, "data.noun"), "utf8"),
  v: readFileSync(path.join(dictDir, "data.verb"), "utf8"),
  a: readFileSync(path.join(dictDir, "data.adj"), "utf8"),
  r: readFileSync(path.join(dictDir, "data.adv"), "utf8"),
};

const pairs = extractDerivationalLemmaPairs(dataFilesByPos);
const roots = rootsFromLemmaPairs(pairs);

const rows = [...roots.entries()].sort(([a], [b]) => a.localeCompare(b));
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, rows.map(([word, root]) => `${word},${root}`).join("\n") + "\n");

console.log(
  `Wrote ${rows.length} candidate roots to ${path.relative(process.cwd(), outPath)} ` +
    `(from ${pairs.length} derivational lemma pairs)`,
);
