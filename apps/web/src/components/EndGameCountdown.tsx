import styles from "./EndGameCountdown.module.css";
import { cx } from "../utils/cx";
import { countdownProgress } from "../utils/countdownProgress";

interface EndGameCountdownProps {
  secondsLeft: number;
  totalSeconds: number;
}

/** Passive readout for the post-bank-empty idle countdown (CLAUDE.md
 * "Game-end condition") — ports design-system/_ds .../components/game/
 * Timer.jsx's bar+digits pattern, sharing countdownProgress's progress/
 * urgency math with TurnTileButton. Unlike that component, this is never
 * clickable — there's nothing to act on here, just time passing. */
export function EndGameCountdown({ secondsLeft, totalSeconds }: EndGameCountdownProps) {
  const { progress, urgent } = countdownProgress(secondsLeft, totalSeconds);

  return (
    <div className={styles.timer} data-testid="end-game-countdown">
      <span className={styles.label}>Game ends in</span>
      <div className={styles.track}>
        <div
          className={cx(styles.fill, urgent && styles.urgentFill)}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className={cx(styles.digits, urgent && styles.urgentDigits)}>
        {/* Fixed-width digit slot, same as TurnTileButton's .timerDigits —
            without it, "s" hops sideways whenever the count crosses a
            digit-width boundary (e.g. 10s -> 9s). */}
        <span className={styles.digitsNumber}>{secondsLeft}</span>s
      </span>
    </div>
  );
}
