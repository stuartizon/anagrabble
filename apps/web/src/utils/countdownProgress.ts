export const URGENT_THRESHOLD_SEC = 5;

/** Fraction of time remaining (0-1, clamped) and whether we're in the last
 * URGENT_THRESHOLD_SEC seconds — shared between any countdown display
 * (TurnTileButton, EndGameCountdown) so the urgency threshold and the
 * progress-fraction math live in exactly one place. */
export function countdownProgress(
  secondsLeft: number,
  totalSeconds: number,
): { progress: number; urgent: boolean } {
  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0;
  const urgent = secondsLeft <= URGENT_THRESHOLD_SEC;
  return { progress, urgent };
}
