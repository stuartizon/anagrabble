// Ported from design-system/_ds/.../components/game/LetterTile.jsx. Used
// by GameBoard (upturned pool tiles, size="md", the component's own
// default), HomePage's "How it works" section (size="sm", matching
// Home.dc.html's explicit size="sm"), and Loader (state="down" for tiles
// still to settle). The source component also has a `highlight` variant,
// left out until a caller actually needs it.

import styles from "./LetterTile.module.css";
import { cx } from "../utils/cx";

type Size = "sm" | "md" | "lg";
type State = "up" | "down";

interface LetterTileProps {
  letter: string;
  size?: Size;
  /** 'up' shows the letter face-up (the default); 'down' hides it behind
   * a blank, unturned tile face. */
  state?: State;
}

export function LetterTile({ letter, size = "md", state = "up" }: LetterTileProps) {
  return (
    <span className={cx(styles.tile, styles[size], state === "down" && styles.down)}>
      {state === "up" ? letter : ""}
    </span>
  );
}
