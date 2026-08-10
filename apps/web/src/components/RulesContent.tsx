// Matches design-system/RulesContent.dc.html's copy. Split out from
// RulesPage so the same content can back both the standalone page and the
// in-place rules modal (a separate, not-yet-built user story) without
// duplicating it.

import styles from "./RulesContent.module.css";

const SECTIONS = [
  {
    title: "The basics",
    body: [
      "Letter tiles sit face-down in a shared bank. On your turn, flip one face-up so everyone can see it. Anyone who spots a real word in the upturned tiles can play it and add it to their own list. Anyone can also steal a word already on the table by extending it into a longer word.",
    ],
  },
  {
    title: "Playing a word",
    body: [
      "Every word must be at least the minimum length set when the game was created — 3 letters by default. It has to be a real dictionary word: no proper names, no acronyms.",
    ],
  },
  {
    title: "Stealing a word",
    body: [
      "To steal a word, you have to change its root — not just add to it. Pluralizing with an S or changing its tense doesn't count. CAT → CAST is a valid steal. CAT → CATS is not.",
      "A steal must also use every letter of the original word, and the result has to be longer than it — rearranging the same letters into a same-length word doesn't count as a steal.",
    ],
  },
  {
    title: "Scoring",
    body: [
      "Longer words score more. You get 1 point for a word at the minimum length, and 1 more point for each letter beyond that. In a 3-letter-minimum game: 1 point for 3 letters, 2 for 4, 3 for 5, and so on. In a 4-letter-minimum game: 1 point for 4 letters, 2 for 5, 3 for 6.",
    ],
  },
  {
    title: "Turns and timing",
    body: [
      "Take your time deciding whether to turn a tile, up to the maximum set in the game's settings. Whoever makes or steals a word becomes the next player to turn a tile.",
    ],
  },
  {
    title: "Combining words",
    body: [
      "You're allowed to combine two or more words already on the table with zero or more letters from the pot to make one new word. It's rarely easy to find one, but it's legal.",
    ],
  },
];

export function RulesContent() {
  return (
    <div className={styles.sections}>
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <h2 className={styles.sectionTitle}>{section.title}</h2>
          {section.body.map((paragraph, i) => (
            <p key={i} className={styles.sectionBody}>
              {paragraph}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
