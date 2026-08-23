import { LogOut, X } from "lucide-react";
import type { LobbySnapshot, PlayerSettingsResponse } from "@anagrabble/protocol";
import { GameConfigList } from "../../../components/GameConfigList";
import { InviteCode } from "../../../components/InviteCode";
import { Select } from "../../../components/Select";
import { Switch } from "../../../components/Switch";
import { LANGUAGE_OPTIONS } from "../../../usePlayerSettings";
import { PlayersSection } from "./PlayersSection";
import styles from "./MobileMenu.module.css";
import sharedStyles from "./shared.module.css";

interface MobileMenuProps {
  lobby: LobbySnapshot;
  colors: Map<string, string>;
  shareLink: string;
  onClose: () => void;
  onOpenLeaveConfirm: () => void;
  playerSettings: PlayerSettingsResponse | null;
  onUpdatePlayerSettings: (next: PlayerSettingsResponse) => void;
  playerSettingsSaveError: boolean;
}

export function MobileMenu({
  lobby,
  colors,
  shareLink,
  onClose,
  onOpenLeaveConfirm,
  playerSettings,
  onUpdatePlayerSettings,
  playerSettingsSaveError,
}: MobileMenuProps) {
  return (
    <div className={styles.menuOverlay} data-testid="mobile-menu">
      <div className={styles.menuHeader}>
        <span className={styles.menuTitle}>Menu</span>
        <button className={styles.menuCloseButton} aria-label="Close" onClick={onClose}>
          <X size={20} color="var(--text-muted)" />
        </button>
      </div>
      <div className={styles.menuBody}>
        <PlayersSection lobby={lobby} colors={colors} />
        <InviteCode code={lobby.gameId} shareLink={shareLink} />
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
            <div className={styles.switchRow}>
              <span className={styles.switchLabel}>Haptic feedback</span>
              <Switch
                label="Haptic feedback"
                checked={playerSettings.hapticsEnabled}
                onChange={(next) =>
                  onUpdatePlayerSettings({ ...playerSettings, hapticsEnabled: next })
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
          <GameConfigList config={lobby.config} />
        </div>
        <button className={styles.mobileLeaveButton} onClick={onOpenLeaveConfirm}>
          <LogOut size={18} />
          Leave game
        </button>
      </div>
    </div>
  );
}
