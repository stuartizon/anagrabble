import { X } from "lucide-react";
import type { GameConfig, PlayerSettingsResponse } from "@anagrabble/protocol";
import { GameConfigList } from "../../../components/GameConfigList";
import { PlayerSettingsFields } from "../../../components/PlayerSettingsFields";
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
              <PlayerSettingsFields
                settings={playerSettings}
                onUpdate={onUpdatePlayerSettings}
                saveError={playerSettingsSaveError}
                showHaptics={false}
              />
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
