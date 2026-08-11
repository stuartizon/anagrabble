import { describe, expect, it } from "vitest";
import { isValidRootPair } from "./root-relation.mjs";

describe("isValidRootPair", () => {
  it("accepts a shorter word that is a strict prefix of the longer one", () => {
    expect(isValidRootPair("abased", "abase")).toBe(true);
    expect(isValidRootPair("cats", "cat")).toBe(true);
  });

  it("rejects when root is not a prefix of word", () => {
    // CAST is CAT+S combined differently, not CAT as a literal prefix.
    expect(isValidRootPair("cast", "cat")).toBe(false);
  });

  it("rejects when root is empty", () => {
    expect(isValidRootPair("abase", "")).toBe(false);
  });

  it("rejects when root is the same length as word", () => {
    expect(isValidRootPair("abase", "abase")).toBe(false);
  });

  it("rejects when root is longer than word", () => {
    expect(isValidRootPair("abase", "abasement")).toBe(false);
  });
});
