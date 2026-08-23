import { X } from "lucide-react";
import type { GameConfig, PlayerSettingsResponse } from "@anagrabble/protocol";
import { GameConfigList } from "../../../components/GameConfigList";
import { Select } from "../../../components/Select";
import { Switch } from "../../../components/Switch";
import { LANGUAGE_OPTIONS } from "../../../usePlayerSettings";
import styles from "./SettingsModal.module.css";
import sharedStyles from "./shared.module.css";

// Desktop counterpart to MobileMenu's "Your settings"/"Game settings"
// sections — opened via the settings cog in GameBoard's header, which only
// renders at the same >=840px breakpoint this modal is reachable from (see
// GameBoard.module.css's .settingsButton). Skips Invite and Players/scores
// entirely, unlike both MobileMenu and design-system/In Game.dc.html's own
// settingsModalOpen dialog — both are already visible in the desktop
// sidebar, so repeating them here would just be redundant chrome.
interface SettingsModalProps {
  config: GameConfig;
  playerSettings: PlayerSettingsResponse | null;
  onUpdatePlayerSettings: (next: PlayerSettingsResponse) => void;
  playerSettingsSaveError: boolean;
  onClose: () => void;
}

export function SettingsModal({
  config,
  playerSettings,
  onUpdatePlayerSettings,
  playerSettingsSaveError,
  onClose,
}: SettingsModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span id="settings-modal-title" className={styles.title}>
            Settings
          </span>
          <button type="button" className={styles.closeButton} aria-label="Close" onClick={onClose}>
            <X size={20} color="var(--text-muted)" />
          </button>
        </div>
        <div className={styles.body}>
          {playerSettings && (
            <div>
              <div className={sharedStyles.poolLabel}>Your settings</div>
              <Select
                label="Interface language"
                value={playerSettings.language}
                options={LANGUAGE_OPTIONS}
                onChange={() => {
                  // No-op today — only one option exists (see
                  // LANGUAGE_OPTIONS).
                }}
              />
              <div className={styles.switchRow}>
                <span className={styles.switchLabel}>Sound effects</span>
                <Switch
                  label="Sound effects"
                  checked={playerSettings.soundEnabled}
                  onChange={(next) =>
                    onUpdatePlayerSettings({ ...playerSettings, soundEnabled: next })
                  }
                />
              </div>
              {playerSettingsSaveError && (
                <div className={styles.saveError}>Couldn&apos;t save your changes.</div>
              )}
            </div>
          )}
          <div>
            <div className={sharedStyles.poolLabel}>Game settings</div>
            <GameConfigList config={config} />
          </div>
        </div>
      </div>
    </div>
  );
}
