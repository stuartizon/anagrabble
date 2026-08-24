// Ported from design-system/_ds/.../components/brand/Wordmark.jsx — see
// CLAUDE.md "Design system" (typographic wordmark only, no logo asset).

import styles from "./Wordmark.module.css";
import { cx } from "../utils/cx";

interface WordmarkProps {
  size?: "sm" | "md" | "lg";
  color?: string;
}

export function Wordmark({ size = "md", color }: WordmarkProps) {
  return (
    <span className={cx(styles.mark, styles[size])} style={color ? { color } : undefined}>
      anagrabble
    </span>
  );
}
