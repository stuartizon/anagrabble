// Conservative merge: only ever fills currently-blank roots, never
// overwrites an existing one - so a rerun after a source updates can only
// add coverage, and reviewing the change is just a normal git diff of
// data/dictionary-source.csv (see docs/decisions.md "Dictionary source and
// format"). Candidate layers are applied in priority order; a later layer
// only gets to fill what an earlier layer left blank.
import { isValidRootPair } from "./root-relation.mjs";

/**
 * @param {[string, string][]} existingRows ordered [word, root] pairs, root "" if none
 * @param {[string, string][][]} candidateLayers candidate (word, root) pairs, in priority order
 * @returns {{ rows: [string, string][], filledPerLayer: number[], skippedInvalid: number }}
 */
export function mergeDictionaryRoots(existingRows, candidateLayers) {
  const wordSet = new Set(existingRows.map(([word]) => word));
  const rootByWord = new Map(existingRows.map(([word, root]) => [word, root]));
  const filledPerLayer = candidateLayers.map(() => 0);
  let skippedInvalid = 0;

  candidateLayers.forEach((layer, layerIndex) => {
    for (const [word, root] of layer) {
      if (!wordSet.has(word)) continue; // not a word this dictionary tracks
      if (rootByWord.get(word)) continue; // already filled - never overwrite
      if (!wordSet.has(root) || !isValidRootPair(word, root)) {
        skippedInvalid++;
        continue;
      }
      rootByWord.set(word, root);
      filledPerLayer[layerIndex]++;
    }
  });

  const rows = existingRows.map(([word]) => [word, rootByWord.get(word) ?? ""]);
  return { rows, filledPerLayer, skippedInvalid };
}
