import { useEffect, useState } from "react";
import { remainingSeconds } from "./remainingSeconds";

// Purely a countdown display now — see docs/decisions.md "Turn-timer
// polling sweep": forcing an expired turn is the server's job
// (apps/server/src/turnTimerSweep.ts), not a background auto-fire effect
// here. The manual "turn a tile" click (GameBoard/index.tsx's turnTile)
// still sends TurnTile directly; this hook has nothing to send.
interface UseTurnTimerArgs {
  turnDeadline: number | null;
}

export function useTurnTimer({ turnDeadline }: UseTurnTimerArgs): number {
  const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(turnDeadline));

  useEffect(() => {
    setSecondsLeft(remainingSeconds(turnDeadline));
    if (turnDeadline === null) return;

    const interval = setInterval(() => setSecondsLeft(remainingSeconds(turnDeadline)), 250);
    return () => clearInterval(interval);
  }, [turnDeadline]);

  return secondsLeft;
}
