import { describe, expect, it } from "vitest";
import { mergeDictionaryRoots } from "./merge-roots.mjs";

describe("mergeDictionaryRoots", () => {
  it("fills a blank root from the first layer that has a valid candidate", () => {
    const existing = [
      ["abase", ""],
      ["abaser", ""],
    ];
    const { rows, filledPerLayer } = mergeDictionaryRoots(existing, [[["abaser", "abase"]]]);
    expect(rows).toEqual([
      ["abase", ""],
      ["abaser", "abase"],
    ]);
    expect(filledPerLayer).toEqual([1]);
  });

  it("never overwrites an already-recorded root, even with a differing candidate", () => {
    const existing = [
      ["cat", ""],
      ["cats", "cat"],
    ];
    const { rows, filledPerLayer } = mergeDictionaryRoots(existing, [[["cats", "cat-typo"]]]);
    expect(rows).toEqual([
      ["cat", ""],
      ["cats", "cat"],
    ]);
    expect(filledPerLayer).toEqual([0]);
  });

  it("only lets a later layer fill what an earlier layer left blank", () => {
    const existing = [
      ["abase", ""],
      ["abaser", ""],
      ["urban", ""],
      ["urbanist", ""],
    ];
    const wordnetLayer = [["urbanist", "urban"]]; // WordNet doesn't know about ABASER
    const wiktionaryLayer = [
      ["abaser", "abase"],
      ["urbanist", "urban"], // would also fill this, but it's already filled
    ];
    const { rows, filledPerLayer } = mergeDictionaryRoots(existing, [
      wordnetLayer,
      wiktionaryLayer,
    ]);
    expect(rows).toEqual([
      ["abase", ""],
      ["abaser", "abase"],
      ["urban", ""],
      ["urbanist", "urban"],
    ]);
    expect(filledPerLayer).toEqual([1, 1]); // wiktionary only got credit for ABASER
  });

  it("skips a candidate word that isn't in the dictionary at all", () => {
    const existing = [["abase", ""]];
    const { rows, filledPerLayer } = mergeDictionaryRoots(existing, [[["notarealword", "abase"]]]);
    expect(rows).toEqual([["abase", ""]]);
    expect(filledPerLayer).toEqual([0]);
  });

  it("skips and counts a candidate whose root isn't itself a dictionary word", () => {
    const existing = [["abaser", ""]];
    const { rows, skippedInvalid } = mergeDictionaryRoots(existing, [[["abaser", "abase"]]]);
    expect(rows).toEqual([["abaser", ""]]);
    expect(skippedInvalid).toBe(1);
  });

  it("skips and counts a candidate that isn't a valid prefix relationship", () => {
    const existing = [
      ["cast", ""],
      ["cat", ""],
    ];
    const { rows, skippedInvalid } = mergeDictionaryRoots(existing, [[["cast", "cat"]]]);
    expect(rows).toEqual([
      ["cast", ""],
      ["cat", ""],
    ]);
    expect(skippedInvalid).toBe(1);
  });

  it("preserves original row order regardless of candidate order", () => {
    const existing = [
      ["zebra", ""],
      ["apple", ""],
    ];
    const { rows } = mergeDictionaryRoots(existing, []);
    expect(rows.map(([word]) => word)).toEqual(["zebra", "apple"]);
  });
});
