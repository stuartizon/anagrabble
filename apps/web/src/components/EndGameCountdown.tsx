import styles from "./EndGameCountdown.module.css";
import { cx } from "../cx";
import { countdownProgress } from "../countdownProgress";

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
      <div className={styles.track}>
        <div
          className={cx(styles.fill, urgent && styles.urgentFill)}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className={cx(styles.digits, urgent && styles.urgentDigits)}>{secondsLeft}s</span>
    </div>
  );
}
