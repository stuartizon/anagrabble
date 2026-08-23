import type { PlayerSettingsResponse } from "@anagrabble/protocol";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { LANGUAGE_OPTIONS } from "../usePlayerSettings";
import styles from "./PlayerSettingsFields.module.css";

// The "Your settings" fields (interface language, sound effects, haptic
// feedback), shared by SettingsPage (the standalone /settings page),
// MobileMenu (the in-game mobile menu), and SettingsModal (the in-game
// desktop settings modal) — same fields, same wiring, three different
// surrounding surfaces. Each surface differs in exactly two ways this
// component parameterizes rather than duplicates:
//   - `showHaptics`: SettingsModal omits it — nothing to toggle on desktop.
//   - `hapticsHint`: only SettingsPage shows "(mobile only)" next to it,
//     since only that page is realistically viewed on desktop where a
//     player wouldn't otherwise know haptics does nothing there; the
//     mobile menu is by definition already on mobile, so the hint would be
//     redundant.
// `variant` picks between two spacing treatments matching each surface's
// own design-system mockup (SettingsPage.dc.html's roomier standalone card
// vs. In Game.dc.html's tighter menu/modal rows) — not a meaningful
// behavioral difference, just what each source actually specifies.
interface PlayerSettingsFieldsProps {
  settings: PlayerSettingsResponse;
  onUpdate: (next: PlayerSettingsResponse) => void;
  saveError: boolean;
  showHaptics?: boolean;
  hapticsHint?: boolean;
  variant?: "page" | "compact";
}

export function PlayerSettingsFields({
  settings,
  onUpdate,
  saveError,
  showHaptics = true,
  hapticsHint = false,
  variant = "compact",
}: PlayerSettingsFieldsProps) {
  const switchRowClass = variant === "page" ? styles.switchRowPage : styles.switchRow;

  const fields = (
    <>
      <Select
        label="Interface language"
        value={settings.language}
        options={LANGUAGE_OPTIONS}
        onChange={() => {
          // No-op today — only one option exists (see LANGUAGE_OPTIONS).
        }}
      />
      <div className={switchRowClass}>
        <span className={styles.switchLabel}>Sound effects</span>
        <Switch
          label="Sound effects"
          checked={settings.soundEnabled}
          onChange={(next) => onUpdate({ ...settings, soundEnabled: next })}
        />
      </div>
      {showHaptics && (
        <div className={switchRowClass}>
          <span className={styles.switchLabel}>
            Haptic feedback
            {hapticsHint && <span className={styles.switchLabelHint}> (mobile only)</span>}
          </span>
          <Switch
            label="Haptic feedback"
            checked={settings.hapticsEnabled}
            onChange={(next) => onUpdate({ ...settings, hapticsEnabled: next })}
          />
        </div>
      )}
    </>
  );

  if (variant === "page") {
    return (
      <>
        <div className={styles.controlsPage}>{fields}</div>
        {saveError && <div className={styles.saveErrorPage}>Couldn&apos;t save your changes.</div>}
      </>
    );
  }

  return (
    <>
      {fields}
      {saveError && <div className={styles.saveError}>Couldn&apos;t save your changes.</div>}
    </>
  );
}
