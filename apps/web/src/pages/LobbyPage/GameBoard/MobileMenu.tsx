import { LogOut, X } from "lucide-react";
import type { LobbySnapshot } from "@anagrabble/protocol";
import { GameConfigList } from "../../../components/GameConfigList";
import { PlayersAndInviteSections } from "./PlayersAndInviteSections";
import styles from "./MobileMenu.module.css";
import sharedStyles from "./shared.module.css";

interface MobileMenuProps {
  lobby: LobbySnapshot;
  colors: Map<string, string>;
  shareLink: string;
  onClose: () => void;
  onOpenLeaveConfirm: () => void;
}

export function MobileMenu({
  lobby,
  colors,
  shareLink,
  onClose,
  onOpenLeaveConfirm,
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
        <PlayersAndInviteSections lobby={lobby} colors={colors} shareLink={shareLink} />
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
