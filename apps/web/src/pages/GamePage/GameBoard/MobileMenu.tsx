import { LogOut, X } from "lucide-react";
import type { GameSnapshot, PlayerSettingsResponse } from "@anagrabble/protocol";
import { GameConfigList } from "../../../components/GameConfigList";
import { InviteCode } from "../../../components/InviteCode";
import { PlayerSettingsFields } from "../../../components/PlayerSettingsFields";
import { PlayersSection } from "./PlayersSection";
import styles from "./MobileMenu.module.css";
import sharedStyles from "./shared.module.css";

interface MobileMenuProps {
  game: GameSnapshot;
  colors: Map<string, string>;
  shareLink: string;
  onClose: () => void;
  onOpenLeaveConfirm: () => void;
  playerSettings: PlayerSettingsResponse | null;
  onUpdatePlayerSettings: (next: PlayerSettingsResponse) => void;
  playerSettingsSaveError: boolean;
}

export function MobileMenu({
  game,
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
        <PlayersSection game={game} colors={colors} />
        <InviteCode code={game.gameId} shareLink={shareLink} />
        {playerSettings && (
          <div>
            <div className={sharedStyles.poolLabel}>Your settings</div>
            <PlayerSettingsFields
              settings={playerSettings}
              onUpdate={onUpdatePlayerSettings}
              saveError={playerSettingsSaveError}
            />
          </div>
        )}
        <div>
          <div className={sharedStyles.poolLabel}>Game settings</div>
          <GameConfigList config={game.config} />
        </div>
        <button className={styles.mobileLeaveButton} onClick={onOpenLeaveConfirm}>
          <LogOut size={18} />
          Leave game
        </button>
      </div>
    </div>
  );
}
