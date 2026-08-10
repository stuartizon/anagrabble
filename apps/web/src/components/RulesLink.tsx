import { useState } from "react";
import { RulesModal } from "./RulesModal";
import styles from "./RulesLink.module.css";

// design-system's New Game, Join Game, and Lobby screens each show a link
// that opens the rules modal, but disagree with each other on both copy
// ("Rules" vs. "Review the rules while you're waiting") and alignment (left
// vs. right) — normalized here to one consistent instance, reused wherever
// that link appears, rather than each page choosing its own. See
// docs/user-stories.md "Home & rules"'s in-place-modal story.
export function RulesLink() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={styles.link} onClick={() => setOpen(true)}>
        Review the rules
      </button>
      {open && <RulesModal onClose={() => setOpen(false)} />}
    </>
  );
}
