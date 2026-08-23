import { useEffect, useRef, useState } from "react";
import type { Command } from "@anagrabble/protocol";
import { makeCommandId } from "../../../gameId";
import { remainingSeconds } from "./remainingSeconds";

interface UseEndGameTimerArgs {
  endGameDeadline: number | null;
  gameId: string;
  send: (command: Command) => void;
}

// Same client-triggered, server-verified pattern as useTurnTimer, but for
// the post-bank-empty idle countdown (CLAUDE.md "Game-end condition").
// Callers gate `endGameDeadline` on status === "playing" so this stops
// firing once the game has actually ended.
export function useEndGameTimer({ endGameDeadline, gameId, send }: UseEndGameTimerArgs): number {
  const [endGameSecondsLeft, setEndGameSecondsLeft] = useState(() =>
    remainingSeconds(endGameDeadline),
  );
  const firedForEndDeadline = useRef<number | null>(null);

  useEffect(() => {
    setEndGameSecondsLeft(remainingSeconds(endGameDeadline));
    firedForEndDeadline.current = null;
    if (endGameDeadline === null) return;

    const interval = setInterval(() => {
      setEndGameSecondsLeft(remainingSeconds(endGameDeadline));
      if (Date.now() >= endGameDeadline && firedForEndDeadline.current !== endGameDeadline) {
        firedForEndDeadline.current = endGameDeadline;
        send({ type: "EndGame", commandId: makeCommandId(), gameId });
      }
    }, 250);

    return () => clearInterval(interval);
  }, [endGameDeadline, gameId, send]);

  return endGameSecondsLeft;
}
