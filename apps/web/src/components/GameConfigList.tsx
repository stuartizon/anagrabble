import type { GameConfig } from "@anagrabble/protocol";
import { cx } from "../utils/cx";
import styles from "./GameConfigList.module.css";

// Shared by WaitingRoomCard, JoinInProgressCard, and the in-game mobile
// menu — same three rows everywhere, just embedded in a different
// surrounding card/section.
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
