import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import {
  fetchPlayerSettings,
  savePlayerSettings,
  type PlayerSettingsResponse,
} from "../client/fetchPlayerSettings";

// Single-option today — only "English" is supported (see
// docs/user-stories.md "Settings", archived). The control still renders,
// matching design-system/Settings.dc.html's layout, ready to grow without a
// UI change once a second language exists.
export const LANGUAGE_OPTIONS = [{ label: "English", value: "English" }];

export type PlayerSettingsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; settings: PlayerSettingsResponse };

// Shared by SettingsPage (its whole page) and LobbyPage (owns it for the
// in-game mobile menu's "Your settings" section — anagrabble#40) — those two
// call sites are never mounted simultaneously, so independent hook instances
// are fine; there's nothing to keep in sync between them. See anagrabble#37
// "`soundEnabled` and a future in-game settings toggle" for why this needed
// extracting rather than staying inline in SettingsPage.tsx once a second
// call site existed.
export function usePlayerSettings() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const [state, setState] = useState<PlayerSettingsState>({ status: "loading" });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error("No auth token");
        const settings = await fetchPlayerSettings(token);
        if (!cancelled) setState({ status: "loaded", settings });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (next: PlayerSettingsResponse) => {
    const previous = stateRef.current;
    setState({ status: "loaded", settings: next });
    setSaveError(false);
    try {
      const token = await getTokenRef.current();
      if (!token) throw new Error("No auth token");
      const saved = await savePlayerSettings(token, next);
      setState({ status: "loaded", settings: saved });
    } catch {
      setState(previous);
      setSaveError(true);
    }
  }, []);

  return { state, saveError, update };
}
