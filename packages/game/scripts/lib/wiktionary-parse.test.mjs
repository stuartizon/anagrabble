import { describe, expect, it } from "vitest";
import { extractEtymologyComponents, pickRootFromComponents } from "./wiktionary-parse.mjs";

describe("extractEtymologyComponents", () => {
  it("reads a direct 'suffix' template (e.g. resorter)", () => {
    const templates = [
      { name: "suffix", args: { 1: "en", 2: "resort", 3: "er" }, expansion: "resort + -er" },
    ];
    expect(extractEtymologyComponents(templates)).toEqual(new Set(["resort", "er"]));
  });

  it("reads an abbreviated 'suf' template with id annotations (e.g. owler)", () => {
    const templates = [
      {
        name: "suf",
        args: { 1: "en", 2: "owl", 3: "-er", id2: "agent noun", id1: "smuggle" },
        expansion: "owl + -er",
      },
    ];
    expect(extractEtymologyComponents(templates)).toEqual(new Set(["owl", "er"]));
  });

  it("reads a 'compound' template (e.g. barefooted)", () => {
    const templates = [
      { name: "compound", args: { 1: "en", 2: "bare", 3: "footed" }, expansion: "bare + footed" },
    ];
    expect(extractEtymologyComponents(templates)).toEqual(new Set(["bare", "footed"]));
  });

  it("reads the generic 'ety' wrapper when its code is a recognized affix type (e.g. abaser)", () => {
    const templates = [
      {
        name: "ety",
        args: { 1: "en", 2: ":af", 3: "abase", 4: "-er<id:agent noun>", text: "+", tree: "1" },
        expansion: "From abase + -er.",
      },
    ];
    expect(extractEtymologyComponents(templates)).toEqual(new Set(["abase", "er"]));
  });

  it("excludes the prefix piece from a named 'prefix' template (e.g. unhappy)", () => {
    // Real Wiktextract shape: arg "2" is always the prefix here, with no
    // hyphen in the raw value at all - "un" must never be treated as
    // UNHAPPY's root, or a steal of "un" into "unhappy" would be wrongly
    // blocked as a trivial extension when it's the opposite.
    const templates = [
      { name: "prefix", args: { 1: "en", 2: "un", 3: "happy" }, expansion: "un- + happy" },
    ];
    expect(extractEtymologyComponents(templates)).toEqual(new Set(["happy"]));
  });

  it("excludes a trailing-hyphen prefix fragment from a generic 'ety' affix template (e.g. abampere)", () => {
    const templates = [
      {
        name: "ety",
        args: { 1: "en", 2: ":af", 3: "ab-<id:absolute><t:absolute>", 4: "ampere" },
        expansion: "From ab- (“absolute”) + ampere.",
      },
    ];
    expect(extractEtymologyComponents(templates)).toEqual(new Set(["ampere"]));
  });

  it("ignores 'ety' wrapper codes that aren't affix/compound relations (e.g. inherited-from)", () => {
    const templates = [{ name: "ety", args: { 1: "en", 2: ":inh", 3: "aller" } }];
    expect(extractEtymologyComponents(templates)).toEqual(new Set());
  });

  it("ignores unrelated templates entirely", () => {
    const templates = [{ name: "cog", args: { 1: "de", 2: "frei" } }];
    expect(extractEtymologyComponents(templates)).toEqual(new Set());
  });

  it("returns an empty set for no templates", () => {
    expect(extractEtymologyComponents(undefined)).toEqual(new Set());
    expect(extractEtymologyComponents([])).toEqual(new Set());
  });
});

describe("pickRootFromComponents", () => {
  it("picks the component that is a strict prefix of word, ignoring affix fragments", () => {
    expect(pickRootFromComponents("abaser", new Set(["abase", "er"]))).toBe("abase");
  });

  it("picks the component that happens to be a literal prefix, even for a compound", () => {
    // barefooted = bare + footed; "bare" is coincidentally also a strict
    // prefix of the whole word, so it's a legitimate root by the existing
    // convention even though "footed" (the other real component) isn't.
    expect(pickRootFromComponents("barefooted", new Set(["bare", "footed"]))).toBe("bare");
  });

  it("picks the shortest valid candidate on conflict", () => {
    expect(pickRootFromComponents("resorters", new Set(["resort", "resorter"]))).toBe("resort");
  });
});
