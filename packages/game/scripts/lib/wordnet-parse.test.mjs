import { describe, expect, it } from "vitest";
import {
  extractDerivationalLemmaPairs,
  parsePlusPointers,
  parseSynsetWords,
  rootsFromLemmaPairs,
} from "./wordnet-parse.mjs";

// Real WordNet 3.0 lines (dict/data.verb and dict/data.noun) covering the
// abase -> abasement relation used as the motivating example throughout the
// dictionary-quality discussion.
const VERB_LINE =
  "01799794 37 v 05 humiliate 0 mortify 1 chagrin 1 humble 0 abase 0 011 @ 01793177 v 0000 + 00273449 n 0502 + 07507742 n 0301 + 07507742 n 0203 + 07309223 n 0202 + 14440488 n 0101 + 07507742 n 0102 + 07309223 n 0101 + 00273449 n 0101 ~ 01800195 v 0000 ~ 01800422 v 0000 02 + 09 00 + 10 00 | cause to feel shame";
const NOUN_LINE =
  "00273449 04 n 02 humiliation 0 abasement 0 004 @ 00271263 n 0000 + 01799794 v 0205 + 01799794 v 0101 ~ 00273601 n 0000 | depriving one of self-esteem";

describe("parseSynsetWords", () => {
  it("extracts offset and word list, decoding the hex word count", () => {
    expect(parseSynsetWords(VERB_LINE)).toEqual({
      offset: "01799794",
      words: ["humiliate", "mortify", "chagrin", "humble", "abase"],
    });
  });

  it("returns null for a non-data line (e.g. license header)", () => {
    expect(parseSynsetWords("  1 This software is licensed...")).toBeNull();
  });
});

describe("parsePlusPointers", () => {
  it("extracts derivationally-related pointers with 1-indexed word positions", () => {
    const pointers = parsePlusPointers(VERB_LINE);
    expect(pointers).toContainEqual({
      targetOffset: "00273449",
      targetPos: "n",
      srcWordNum: 5,
      tgtWordNum: 2,
    });
  });

  it("skips whole-synset pointers (source or target word number 0000)", () => {
    const line = "01793177 37 v 01 test 0 001 + 00000001 n 0000 | whole-synset pointer";
    expect(parsePlusPointers(line)).toEqual([]);
  });

  it("skips non-derivational pointer symbols", () => {
    const line = "01793177 37 v 01 test 0 001 @ 00000001 v 0101 | hypernym only";
    expect(parsePlusPointers(line)).toEqual([]);
  });
});

describe("extractDerivationalLemmaPairs", () => {
  it("resolves a + pointer to the actual lemma pair across data files", () => {
    const pairs = extractDerivationalLemmaPairs({ v: VERB_LINE, n: NOUN_LINE });
    expect(pairs).toContainEqual(["abase", "abasement"]);
  });

  it("skips pairs involving multi-word phrases", () => {
    const verb = "01000000 37 v 01 foo 0 001 + 02000000 n 0101 | test";
    const noun = "02000000 26 n 01 multi_word_phrase 0 000 | test";
    expect(extractDerivationalLemmaPairs({ v: verb, n: noun })).toEqual([]);
  });
});

describe("rootsFromLemmaPairs", () => {
  it("picks the shorter word as root when it's a strict prefix of the longer", () => {
    const roots = rootsFromLemmaPairs([["abase", "abasement"]]);
    expect(roots.get("abasement")).toBe("abase");
  });

  it("discards pairs that aren't a prefix relationship (unrelated etymology)", () => {
    const roots = rootsFromLemmaPairs([["alder", "owler"]]);
    expect(roots.has("owler")).toBe(false);
  });

  it("keeps the shortest candidate root on conflict", () => {
    const roots = rootsFromLemmaPairs([
      ["abasement", "abasements"],
      ["abase", "abasements"],
    ]);
    expect(roots.get("abasements")).toBe("abase");
  });
});
