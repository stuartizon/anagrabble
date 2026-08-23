import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Select } from "../components/Select";
import { Switch } from "../components/Switch";
import { Loader } from "../components/Loader";
import { PageShell, PageContent, NarrowColumn } from "../components/Layout";
import { LANGUAGE_OPTIONS, usePlayerSettings } from "../usePlayerSettings";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const { state, saveError, update } = usePlayerSettings();

  return (
    <PageShell>
      <Header />
      <PageContent>
        <NarrowColumn>
          {state.status === "loading" && <Loader />}
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
                    onChange={(next) => update({ ...state.settings, soundEnabled: next })}
                  />
                </div>
                <div className={styles.switchRow}>
                  <span className={styles.switchLabel}>
                    Haptic feedback <span className={styles.switchLabelHint}>(mobile only)</span>
                  </span>
                  <Switch
                    label="Haptic feedback"
                    checked={state.settings.hapticsEnabled}
                    onChange={(next) => update({ ...state.settings, hapticsEnabled: next })}
                  />
                </div>
              </div>
              {saveError && (
                <div className={styles.saveError}>Couldn&apos;t save your changes.</div>
              )}
            </Card>
          )}
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}
