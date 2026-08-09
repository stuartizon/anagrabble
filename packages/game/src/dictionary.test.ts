// TDD for the dictionary: see CLAUDE.md "Word formability" and Stuart's
// clarification that root-blocking is transitive but pre-flattened at build
// time (packages/game/scripts/build-dictionary.mjs collapses chains in
// data/dictionary-source.tsv down to data/dictionary.tsv, so lookups here are
// a single hop, not a chain walk).

import { describe, expect, it } from "vitest";
import { isDerivedFrom, isWord, rootOf } from "./dictionary.js";

describe("isWord", () => {
  it("accepts words present in the dictionary", () => {
    expect(isWord("cat")).toBe(true);
    expect(isWord("abated")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isWord("CAT")).toBe(true);
  });

  it("rejects words absent from the dictionary", () => {
    expect(isWord("zzzzznotaword")).toBe(false);
  });
});

describe("rootOf", () => {
  it("returns the root for a word with a directly recorded parent", () => {
    expect(rootOf("cats")).toBe("cat");
  });

  it("returns the already-flattened ultimate root for a multi-hop chain", () => {
    // source data: abasedly -> abased -> abase; build script should have
    // collapsed this to abasedly -> abase directly.
    expect(rootOf("abasedly")).toBe("abase");
  });

  it("returns undefined for a word with no recorded root", () => {
    expect(rootOf("cat")).toBeUndefined();
  });

  it("returns undefined for a word not in the dictionary", () => {
    expect(rootOf("zzzzznotaword")).toBeUndefined();
  });
});

describe("isDerivedFrom", () => {
  it("is true when word's root is exactly the given base", () => {
    expect(isDerivedFrom("abated", "abate")).toBe(true);
    expect(isDerivedFrom("cats", "cat")).toBe(true);
  });

  it("is true across a flattened multi-hop chain", () => {
    expect(isDerivedFrom("abasedly", "abase")).toBe(true);
  });

  it("is false when the word has a different (or no) root", () => {
    expect(isDerivedFrom("cast", "cat")).toBe(false);
    expect(isDerivedFrom("cats", "abate")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isDerivedFrom("Abated", "ABATE")).toBe(true);
  });
});
