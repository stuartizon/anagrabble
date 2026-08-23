import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth";
import { fetchPlayerSettings } from "../../fetchPlayerSettings";
import { useGameSounds } from "../../useGameSounds";

// Sound effects (anagrabble#36) — owned by LobbyPage rather than GameBoard
// so TileTurned can drive a sound via a callback into useGameSocket, rather
// than threading a "something happened" state field through just for
// GameBoard to useEffect on. Defaults to on (matches the Postgres
// `player_settings` default) so a sound can play before this fetch
// resolves; flips off shortly after mount if the player has actually
// disabled it. See useGameSounds.ts for why this is Web Audio buffers
// rather than <audio> elements.
export function useSoundSettings() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const [soundEnabled, setSoundEnabled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) return;
        const settings = await fetchPlayerSettings(token);
        if (!cancelled) setSoundEnabled(settings.soundEnabled);
      } catch {
        // Keep the default (sound on) if settings can't be loaded.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return useGameSounds(soundEnabled);
}
