import { useCallback, useEffect, useRef } from "react";

// Same three moments as useGameSounds' SoundName — every call site fires
// both together, so the two stay in lockstep rather than drifting into
// separate event lists. Patterns (ms) are deliberately distinct so a player
// can tell tile turns, claims, and rejections apart by feel alone: a single
// short tick, a firmer double pulse, and a longer buzz-buzz-buzz.
export type HapticName = "tileTurn" | "wordClaim" | "wordRejected";

const HAPTIC_PATTERNS: Record<HapticName, VibratePattern> = {
  tileTurn: 10,
  wordClaim: [15, 30, 15],
  wordRejected: [20, 40, 20, 40, 20],
};

// navigator.vibrate is unsupported on iOS Safari (silently absent, not
// throwing) — the optional chaining below makes that a no-op there rather
// than a crash, matching the "(mobile only)" hint on the setting itself.
export function useHaptics(enabled: boolean) {
  // Read via ref rather than as a useCallback dependency — same reasoning as
  // useGameSounds' playSound (stable identity regardless of the enabled
  // flag). useWordFeedback's effects depend on `vibrate` itself; with
  // `enabled` as a dependency instead, toggling the setting mid-game gave
  // `vibrate` a new identity, which alone re-fired those effects and
  // replayed the last wordPlay's haptic (and its paired sound) even though
  // nothing about the actual game state had changed.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const vibrate = useCallback((name: HapticName) => {
    if (!enabledRef.current) return;
    navigator.vibrate?.(HAPTIC_PATTERNS[name]);
  }, []);

  return { vibrate };
}
