// Ported from design-system/_ds/.../components/game/LetterTile.jsx. Used
// by GameBoard (upturned pool tiles, size="md", the component's own
// default) and HomePage's "How it works" section (size="sm", matching
// Home.dc.html's explicit size="sm"). Only the face-up, non-highlighted
// look either caller currently needs — the source component also has
// `state="down"` and `highlight` variants, left out until a caller
// actually needs them.

import styles from "./LetterTile.module.css";
import { cx } from "../cx";

type Size = "sm" | "md" | "lg";

interface LetterTileProps {
  letter: string;
  size?: Size;
}

export function LetterTile({ letter, size = "md" }: LetterTileProps) {
  return <span className={cx(styles.tile, styles[size])}>{letter}</span>;
}
