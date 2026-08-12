// Ported from the Claude Design export (design-system loader.card.html /
// TileLoader.jsx) — letter tiles that resolve into a word, reusing the
// game's own core LetterTile as a loading indicator instead of a generic
// spinner. Face-down tiles turn over left-to-right in sequence, reading as
// tiles drawn from the bank. Loops indefinitely; no bounce/spring easing,
// matching the design system's restrained motion rules.

import { useEffect, useState } from "react";
import styles from "./Loader.module.css";
import { LetterTile } from "./LetterTile";

type Size = "sm" | "md" | "lg";

interface LoaderProps {
  /** Word the tiles settle into. */
  word?: string;
  size?: Size;
}

export function Loader({ word = "LOADING", size = "md" }: LoaderProps) {
  const target = word.toUpperCase().split("");
  const [settled, setSettled] = useState(0);

  useEffect(() => {
    const letters = word.toUpperCase().split("");
    const step = 240;
    const PAUSE = 800;

    let settle: ReturnType<typeof setInterval> | undefined;
    let hold: ReturnType<typeof setTimeout> | undefined;

    // A single settle→hold→reset cycle, driven by one interval that's
    // cleared as soon as every letter has settled — rather than an
    // interval left running forever, which would otherwise fire
    // indefinitely once settled and stack up a fresh overlapping `hold`
    // timeout on every tick.
    function runCycle() {
      setSettled(0);
      let count = 0;
      settle = setInterval(() => {
        count += 1;
        setSettled(count);
        if (count >= letters.length) {
          clearInterval(settle);
          hold = setTimeout(runCycle, PAUSE);
        }
      }, step);
    }

    runCycle();

    return () => {
      if (settle) clearInterval(settle);
      if (hold) clearTimeout(hold);
    };
  }, [word]);

  return (
    <div className={styles.tiles} data-testid="loader">
      {target.map((letter, i) => (
        <LetterTile key={i} letter={letter} size={size} state={i < settled ? "up" : "down"} />
      ))}
    </div>
  );
}
