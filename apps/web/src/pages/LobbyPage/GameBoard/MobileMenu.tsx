import { LogOut, X } from "lucide-react";
import type { LobbySnapshot } from "@anagrabble/protocol";
import { PlayersAndInviteSections } from "./PlayersAndInviteSections";
import styles from "./GameBoard.module.css";

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
        <button className={styles.mobileLeaveButton} onClick={onOpenLeaveConfirm}>
          <LogOut size={18} />
          Leave game
        </button>
      </div>
    </div>
  );
}
