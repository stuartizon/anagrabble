#!/usr/bin/env node
// Downloads the Wiktextract/kaikki.org full raw dump (CC BY-SA 4.0, same
// license as Wiktionary itself - see https://kaikki.org/dictionary/about.html
// and docs/decisions.md "Dictionary source and format" for why that
// obligation is scoped to this generated file, not the rest of the
// codebase), streams and filters it down to English entries for words the
// dictionary currently has no root for, and writes a candidate (word, root)
// CSV to data/generated/wiktionary-roots.csv. This is the second, larger
// layer of scripts/merge-dictionary-roots.mjs - it only fills gaps
// scripts/fetch-wordnet-roots.mjs's smaller vocabulary leaves behind (e.g.
// ABASER, which isn't in WordNet at all). Re-run any time
// (pnpm fetch:wiktionary-roots); the dump is ~2.8GB compressed so this
// caches aggressively - pass --force to re-download.
//
// Attribution (carried through to whoever consumes data/generated/wiktionary-roots.csv):
// derived from Wiktionary (https://en.wiktionary.org) via Wiktextract
// (https://kaikki.org), both CC BY-SA 4.0.
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractEtymologyComponents, pickRootFromComponents } from "./lib/wiktionary-parse.mjs";
import { isValidRootPair } from "./lib/root-relation.mjs";

const DUMP_URL = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz";

const dir = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(dir, "..", "data", ".cache");
const dumpPath = path.join(cacheDir, "wiktextract.jsonl.gz");
const sourcePath = path.join(dir, "..", "data", "dictionary-source.csv");
const outPath = path.join(dir, "..", "data", "generated", "wiktionary-roots.csv");

const force = process.argv.includes("--force");

mkdirSync(cacheDir, { recursive: true });

if (force || !existsSync(dumpPath)) {
  console.log(`Downloading ${DUMP_URL} (~2.8GB, this will take a while) ...`);
  const response = await fetch(DUMP_URL);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  await pipeline(response.body, createWriteStream(dumpPath));
  console.log(`Saved to ${path.relative(process.cwd(), dumpPath)}`);
} else {
  console.log(
    `Using cached ${path.relative(process.cwd(), dumpPath)} (pass --force to re-download)`,
  );
}

// Only words the dictionary currently has no root for are worth asking
// Wiktionary about - and the candidate root itself must be a word already
// in the dictionary, or the game could never let a player claim it.
const dictionaryWords = new Map();
for (const line of readFileSync(sourcePath, "utf8").split("\n")) {
  if (!line) continue;
  const [word, root = ""] = line.split(",");
  dictionaryWords.set(word, root);
}
const targets = new Set([...dictionaryWords].filter(([, root]) => !root).map(([word]) => word));
console.log(`Looking for roots for ${targets.size} currently-blank words`);

const componentsByWord = new Map();
let scanned = 0;
const rl = createInterface({
  input: createReadStream(dumpPath).pipe(createGunzip()),
  crlfDelay: Infinity,
});
for await (const line of rl) {
  if (!line) continue;
  scanned++;
  if (scanned % 2_000_000 === 0) console.log(`...${scanned} lines scanned`);
  if (!line.includes('"lang_code": "en"') && !line.includes('"lang_code":"en"')) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.lang_code !== "en" || !targets.has(entry.word)) continue;
  const existing = componentsByWord.get(entry.word) ?? new Set();
  for (const c of extractEtymologyComponents(entry.etymology_templates)) existing.add(c);
  componentsByWord.set(entry.word, existing);
}
console.log(
  `Scanned ${scanned} entries; matched ${componentsByWord.size} target words with etymology data`,
);

const rows = [];
for (const [word, components] of componentsByWord) {
  const root = pickRootFromComponents(word, components);
  if (root && dictionaryWords.has(root) && isValidRootPair(word, root)) {
    rows.push([word, root]);
  }
}
rows.sort(([a], [b]) => a.localeCompare(b));

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, rows.map(([word, root]) => `${word},${root}`).join("\n") + "\n");
console.log(`Wrote ${rows.length} candidate roots to ${path.relative(process.cwd(), outPath)}`);
