import { useRef, useState } from "react";
import type { Command } from "@anagrabble/protocol";
import { makeCommandId } from "../../../utils/commandId";

// Turning a tile and playing a word are both meant to be quick side-actions
// mid-typing on desktop, not a context switch — a native <button> otherwise
// steals focus on click (Chrome/Edge; not Safari), forcing a re-click into
// the word box to keep typing. On a touch device, though, focusing the
// input opens the on-screen keyboard, and forcing that open after every
// tile turn/word play (rather than only when the player deliberately taps
// the input themselves) is exactly the jerk-around-the-screen behavior this
// is avoiding — so this only refocuses on devices with a real pointer, and
// explicitly blurs (closing the keyboard) on touch devices instead once a
// word's been played.
function canRefocusWithoutKeyboard(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

interface UseWordFormArgs {
  gameId: string;
  send: (command: Command) => void;
  registerAttempt: (commandId: string, word: string) => void;
}

// Owns the word input's value/ref and submission — `refocusInput` is
// exposed separately from `submitWord` so the turn-tile action (a
// different command entirely, but the same "don't steal focus on desktop,
// don't pop the keyboard on touch" behavior) can reuse it too.
export function useWordForm({ gameId, send, registerAttempt }: UseWordFormArgs) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [wordValue, setWordValue] = useState("");

  const refocusInput = () => {
    if (canRefocusWithoutKeyboard()) inputRef.current?.focus();
  };

  const submitWord = (e: React.FormEvent) => {
    e.preventDefault();
    const word = wordValue.trim();
    if (!word) return;
    const commandId = makeCommandId();
    registerAttempt(commandId, word);
    send({ type: "SubmitWord", commandId, gameId, word });
    setWordValue("");
    if (canRefocusWithoutKeyboard()) {
      inputRef.current?.focus();
    } else {
      inputRef.current?.blur();
    }
  };

  return { wordValue, setWordValue, inputRef, submitWord, refocusInput };
}
