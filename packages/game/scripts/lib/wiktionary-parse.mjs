// Parses etymology_templates from a Wiktextract (kaikki.org) JSONL entry
// into candidate root components. Wiktionary's own editors use several
// interchangeable template spellings for the same "word = component + affix"
// relationship, plus a generic "ety" wrapper that hides the actual relation
// type behind a code in arg "2" (e.g. ":af" for affix) - both forms are
// handled here. Pure/testable; the CLI script that owns downloading and
// streaming the actual multi-GB dump lives in fetch-wiktionary-roots.mjs.
//
// Prefix pieces must never be treated as root candidates, even though
// they're structurally a literal prefix of the whole word (which is all
// isValidRootPair checks) - e.g. "unhappy" = "un" + "happy" would otherwise
// let "un" masquerade as UNHAPPY's root, wrongly blocking a steal of AB-
// style short words into much longer ones as a "trivial" extension when
// it's nothing of the sort. Two real, confirmed argument shapes carry a
// prefix/base distinction: named "prefix"/"pre" templates always put the
// prefix in arg "2" (e.g. {2: "un", 3: "happy"}, no hyphen in the value);
// generic "affix"/"af"/"ety" templates instead mark a prefix piece with a
// trailing hyphen in the raw value itself (e.g. "ab-" in "ab- + ampere").
import { isValidRootPair } from "./root-relation.mjs";

const PREFIX_NAMED_TEMPLATES = new Set(["prefix", "pre"]);
const GENERIC_TEMPLATE_NAMES = new Set([
  "suffix",
  "suf",
  "affix",
  "af",
  "compound",
  "confix",
  "con",
  "surf",
]);
const ETY_WRAPPER_CODES = new Set([":af", ":bf", ":con", ":compound", ":suf", ":pre", ":surf"]);
const SKIP_ARG_KEYS = new Set(["1", "id1", "id2", "text", "tree", "nocap", "notext"]);
const SKIP_ETY_ARG_KEYS = new Set(["1", "2", "text", "tree", "id"]);

function parseComponent(value) {
  if (typeof value !== "string") return null;
  const withoutAnnotation = value.split("<")[0]; // strip <id:...>/<ref:...> annotations
  const isPrefixFragment = /-\s*$/.test(withoutAnnotation);
  const text = withoutAnnotation
    .replace(/^-+|-+$/g, "")
    .trim()
    .toLowerCase();
  if (!text || !/^[a-z ]+$/.test(text)) return null;
  return { text, isPrefixFragment };
}

function addNonPrefixComponents(components, args, skipKeys) {
  for (const [key, value] of Object.entries(args)) {
    if (skipKeys.has(key)) continue;
    const parsed = parseComponent(value);
    if (parsed && !parsed.isPrefixFragment) components.add(parsed.text);
  }
}

/**
 * @param {Array<{name: string, args: Record<string, unknown>}>} etymologyTemplates
 * @returns {Set<string>} lowercased candidate component words, excluding
 *   whichever piece was identified as the prefix
 */
export function extractEtymologyComponents(etymologyTemplates) {
  const components = new Set();
  for (const template of etymologyTemplates ?? []) {
    const args = template.args ?? {};
    if (PREFIX_NAMED_TEMPLATES.has(template.name)) {
      // arg "2" is definitionally the prefix for this template shape.
      addNonPrefixComponents(components, args, new Set(["1", "2"]));
    } else if (GENERIC_TEMPLATE_NAMES.has(template.name)) {
      addNonPrefixComponents(components, args, SKIP_ARG_KEYS);
    } else if (template.name === "ety") {
      const code = String(args["2"] ?? "").split("<")[0];
      if (!ETY_WRAPPER_CODES.has(code)) continue;
      if (code === ":pre") {
        addNonPrefixComponents(components, args, new Set(["1", "2", "3"]));
      } else {
        addNonPrefixComponents(components, args, SKIP_ETY_ARG_KEYS);
      }
    }
  }
  return components;
}

/**
 * Of the candidate components found for `word`, picks the shortest one that
 * matches the dictionary's root convention (root is a strict prefix), same
 * tie-break as the WordNet pipeline.
 * @param {string} word
 * @param {Set<string>} components
 * @returns {string | undefined}
 */
export function pickRootFromComponents(word, components) {
  let best;
  for (const component of components) {
    if (!isValidRootPair(word, component)) continue;
    if (!best || component.length < best.length) best = component;
  }
  return best;
}
