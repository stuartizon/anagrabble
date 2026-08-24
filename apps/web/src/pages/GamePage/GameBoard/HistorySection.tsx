import type { GameSnapshot } from "@anagrabble/protocol";
import type { HistoryEntry } from "../../../hooks/useGameSocket";
import { describeJoined, describePlay, playerName } from "./narration";
import styles from "./HistorySection.module.css";
import sharedStyles from "./shared.module.css";

export function HistorySection({
  game,
  colors,
  history,
}: {
  game: GameSnapshot;
  colors: Map<string, string>;
  history: HistoryEntry[];
}) {
  return (
    <div className={styles.historySection}>
      <div className={sharedStyles.poolLabel}>History</div>
      <div className={styles.historyList}>
        {history.length === 0 ? (
          <span className={sharedStyles.wordsEmpty}>Nothing has happened yet.</span>
        ) : (
          [...history].reverse().map((entry) => {
            const name = playerName(game, entry.playerId);
            const text =
              entry.kind === "wordPlay" ? describePlay(name, game, entry) : describeJoined(name);
            return (
              <div key={entry.seq} className={styles.historyEntry}>
                <span
                  className={styles.historyDot}
                  style={{ background: colors.get(entry.playerId) }}
                />
                <span className={styles.historyText}>{text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
