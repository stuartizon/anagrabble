// Shared convention for what counts as a recorded (word, root) pair anywhere
// in the dictionary pipeline: root must be a strictly shorter word that word
// begins with. Matches the suffix-only convention already in
// data/dictionary-source.csv (see CLAUDE.md "Word formability" and
// docs/decisions.md "Dictionary source and format"). Every root-generating
// script (WordNet, Wiktionary, ...) filters its candidates through this same
// function so they can never disagree on what shape a valid pair has.
export function isValidRootPair(word, root) {
  return root.length > 0 && word.length > root.length && word.startsWith(root);
}
