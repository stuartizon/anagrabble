import type { GameConfig } from "@anagrabble/protocol";
import { cx } from "../../cx";
import styles from "./LobbyPage.module.css";

// Shared by WaitingRoomCard and JoinInProgressCard — same three rows either
// way, just embedded in a different surrounding card.
export function GameConfigList({ config }: { config: GameConfig }) {
  return (
    <div className={styles.configList}>
      <div className={styles.configRow}>
        <span className={styles.configLabel}>Language</span>
        <span className={styles.configValue}>{config.language}</span>
      </div>
      <div className={styles.configRow}>
        <span className={styles.configLabel}>Minimum word length</span>
        <span className={styles.configValue}>{config.minWordLength} letters</span>
      </div>
      <div className={cx(styles.configRow, styles.configRowLastOverride)}>
        <span className={styles.configLabel}>Turn timer</span>
        <span className={styles.configValue}>{config.turnTimerSec}s</span>
      </div>
    </div>
  );
}
