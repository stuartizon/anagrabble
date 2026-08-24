import { useEffect, useRef, useState } from "react";
import type { LobbySnapshot } from "@anagrabble/protocol";
import type { GameSocketError, WordPlayNarration } from "../../../hooks/useGameSocket";
import type { SoundName } from "../../../hooks/useGameSounds";
import type { HapticName } from "../../../hooks/useHaptics";
import { errorText, narrateOwnPlay } from "./narration";

const MESSAGE_DISMISS_MS = 2500;

interface UseWordFeedbackArgs {
  lobby: LobbySnapshot;
  playerId: string;
  wordPlay: WordPlayNarration | null;
  error: GameSocketError | null;
  playSound: (name: SoundName) => void;
  vibrate: (name: HapticName) => void;
}

// Owns the one-line toast shown above the word form: a claimed/stolen word
// (own plays only — see the effect below) or a rejected submission, plus
// the sounds that accompany each. `registerAttempt` lets the submit handler
// (useWordForm) record what a given commandId tried to play, so an
// asynchronous rejection can still name the right word even after the
// input's been cleared.
export function useWordFeedback({
  lobby,
  playerId,
  wordPlay,
  error,
  playSound,
  vibrate,
}: UseWordFeedbackArgs) {
  const [message, setMessage] = useState<string | null>(null);
  // Read inside the wordPlay effect via ref rather than as a dependency —
  // lobby gets a new object on every TileTurned/etc. too, and the toast must
  // only (re)trigger when wordPlay itself changes, not on unrelated snapshot
  // updates (that previously reopened a just-dismissed toast on the next
  // tile turn).
  const lobbyRef = useRef(lobby);
  lobbyRef.current = lobby;
  // The input is cleared optimistically on submit, so by the time an Error
  // event comes back asynchronously, the submitted word itself no longer
  // has what was attempted. Keyed by commandId (round-tripped on
  // ErrorEvent) rather than just remembering "the last one" — a player
  // submitting twice before the first rejection comes back must still get
  // the right word named in the right message, not whichever was typed
  // most recently.
  const pendingWordsRef = useRef(new Map<string, string>());

  // Unlike the toast below, the claim sound plays for every word play at
  // the table, not just the actor's own — a claim/steal is public
  // information everyone should hear, same as tile_turn (see anagrabble#36).
  useEffect(() => {
    if (!wordPlay) return;
    playSound("wordClaim");
    vibrate("wordClaim");
  }, [wordPlay, playSound, vibrate]);

  useEffect(() => {
    // Only the actor's own play gets a toast — someone else's success is
    // shared/ambient information (the board itself already reflects it),
    // not personal feedback about this screen, so it doesn't belong in the
    // same slot as this player's own errors. See docs/decisions.md "Toasts
    // are personal, not broadcast narration".
    if (!wordPlay || wordPlay.playerId !== playerId) return;
    setMessage(narrateOwnPlay(lobbyRef.current, wordPlay));
    const timer = setTimeout(() => setMessage(null), MESSAGE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [wordPlay, playerId]);

  useEffect(() => {
    if (!error) return;
    const attemptedWord = error.commandId
      ? (pendingWordsRef.current.get(error.commandId) ?? "")
      : "";
    if (error.commandId) pendingWordsRef.current.delete(error.commandId);
    const text = errorText(error.code, lobby.config.minWordLength, attemptedWord, error.message);
    if (text === null) return;
    playSound("wordRejected");
    vibrate("wordRejected");
    setMessage(text);
    const timer = setTimeout(() => setMessage(null), MESSAGE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [error, lobby.config.minWordLength, playSound, vibrate]);

  const registerAttempt = (commandId: string, word: string) => {
    pendingWordsRef.current.set(commandId, word);
  };

  return { message, registerAttempt };
}
