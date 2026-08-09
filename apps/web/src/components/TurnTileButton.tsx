// The only place a countdown-driven, color-shifting button appears in the
// app — split out from GameBoard purely to keep that file's render from
// being dominated by progress-bar/urgency math, not because it's reused
// anywhere else.

import styles from "./TurnTileButton.module.css";
import { cx } from "../cx";

const URGENT_THRESHOLD_SEC = 5;

interface TurnTileButtonProps {
  secondsLeft: number;
  totalSeconds: number;
  onClick: () => void;
}

export function TurnTileButton({ secondsLeft, totalSeconds, onClick }: TurnTileButtonProps) {
  const urgent = secondsLeft <= URGENT_THRESHOLD_SEC;
  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0;

  return (
    <button
      type="button"
      className={cx(styles.button, urgent && styles.urgent)}
      onClick={onClick}
    >
      {/* Recedes from full width to 0 as time runs out, rather than filling
          up — reads as "time draining away", not "progress toward a goal". */}
      <span className={styles.progress} style={{ width: `${progress * 100}%` }} />
      <span className={styles.label}>Turn a tile</span>
      <span className={styles.timer}>
        {/* Fixed-width digit slot so the button doesn't narrow when the
            countdown drops from a two-digit to a one-digit number. */}
        <span className={styles.timerDigits}>{secondsLeft}</span>s
      </span>
    </button>
  );
}
