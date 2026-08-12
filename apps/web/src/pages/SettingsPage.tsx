import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Select } from "../components/Select";
import { Switch } from "../components/Switch";
import { PageShell, CenteredContent, NarrowColumn } from "../components/Layout";
import {
  fetchPlayerSettings,
  savePlayerSettings,
  type PlayerSettingsResponse,
} from "../fetchPlayerSettings";
import styles from "./SettingsPage.module.css";

// Single-option today — only "English" is supported (see
// docs/user-stories.md "Settings"). The control still renders, matching
// design-system/Settings.dc.html's layout, ready to grow without a UI
// change once a second language exists.
const LANGUAGE_OPTIONS = [{ label: "English", value: "English" }];

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; settings: PlayerSettingsResponse };

export function SettingsPage() {
  const { getToken } = useAuth();
  // Read via a ref, not a useEffect dependency — same reasoning as
  // StatsPage.tsx (Clerk doesn't guarantee getToken's identity is stable
  // across renders).
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const [state, setState] = useState<LoadState>({ status: "loading" });
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

  async function persist(next: PlayerSettingsResponse, previous: PlayerSettingsResponse) {
    setState({ status: "loaded", settings: next });
    setSaveError(false);
    try {
      const token = await getTokenRef.current();
      if (!token) throw new Error("No auth token");
      const saved = await savePlayerSettings(token, next);
      setState({ status: "loaded", settings: saved });
    } catch {
      setState({ status: "loaded", settings: previous });
      setSaveError(true);
    }
  }

  return (
    <PageShell>
      <Header />
      <CenteredContent>
        <NarrowColumn>
          {state.status === "loading" && <Card>Loading your settings…</Card>}
          {state.status === "error" && <Card>Something went wrong loading your settings.</Card>}
          {state.status === "loaded" && (
            <Card>
              <div className={styles.title}>Settings</div>
              <div className={styles.controls}>
                <Select
                  label="Interface language"
                  value={state.settings.language}
                  options={LANGUAGE_OPTIONS}
                  onChange={() => {
                    // No-op today — only one option exists (see
                    // LANGUAGE_OPTIONS above).
                  }}
                />
                <div className={styles.switchRow}>
                  <span className={styles.switchLabel}>Sound effects</span>
                  <Switch
                    label="Sound effects"
                    checked={state.settings.soundEnabled}
                    onChange={(next) =>
                      persist({ ...state.settings, soundEnabled: next }, state.settings)
                    }
                  />
                </div>
                <div className={styles.switchRow}>
                  <span className={styles.switchLabel}>
                    Haptic feedback <span className={styles.switchLabelHint}>(mobile only)</span>
                  </span>
                  <Switch
                    label="Haptic feedback"
                    checked={state.settings.hapticsEnabled}
                    onChange={(next) =>
                      persist({ ...state.settings, hapticsEnabled: next }, state.settings)
                    }
                  />
                </div>
              </div>
              {saveError && (
                <div className={styles.saveError}>Couldn&apos;t save your changes.</div>
              )}
            </Card>
          )}
        </NarrowColumn>
      </CenteredContent>
    </PageShell>
  );
}
