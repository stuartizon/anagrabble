import { useEffect, useRef, useState } from "react";
import type { Command } from "@anagrabble/protocol";
import { makeCommandId } from "../../../utils/gameId";
import { remainingSeconds } from "./remainingSeconds";

interface UseTurnTimerArgs {
  turnDeadline: number | null;
  gameId: string;
  bankCount: number;
  // Drives the fast-skip fast path (apply_turn_tile.lua's
  // currentPlayerUnreachable OR condition — see docs/decisions.md "Player
  // presence: connected/disconnected tracking"): without this, the
  // background auto-fire below would only ever attempt TurnTile once the
  // *original* turnDeadline passes, same as before presence tracking
  // existed, making the server's early-accept branch unreachable in
  // practice. `false` means "don't fire early."
  currentPlayerUnreachable: boolean;
  send: (command: Command) => void;
}

export function useTurnTimer({
  turnDeadline,
  gameId,
  bankCount,
  currentPlayerUnreachable,
  send,
}: UseTurnTimerArgs): number {
  const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(turnDeadline));
  // Guards against every tick after a missed deadline re-firing TurnTile —
  // once we've fired for a given deadline value, wait for the server to
  // hand us a new one (see CLAUDE.md "Turn timer enforcement": any client
  // may trigger it, the server is what actually enforces "just once").
  const firedForDeadline = useRef<number | null>(null);

  useEffect(() => {
    setSecondsLeft(remainingSeconds(turnDeadline));
    firedForDeadline.current = null;
    if (turnDeadline === null || bankCount <= 0) return;

    const fireIfDue = () => {
      setSecondsLeft(remainingSeconds(turnDeadline));
      const due = Date.now() >= turnDeadline || currentPlayerUnreachable;
      if (due && firedForDeadline.current !== turnDeadline) {
        firedForDeadline.current = turnDeadline;
        send({
          type: "TurnTile",
          commandId: makeCommandId(),
          gameId,
          observedTurnDeadline: turnDeadline,
        });
      }
    };

    fireIfDue(); // don't wait for the first 250ms tick once already due
    const interval = setInterval(fireIfDue, 250);

    return () => clearInterval(interval);
  }, [turnDeadline, gameId, send, bankCount, currentPlayerUnreachable]);

  return secondsLeft;
}
