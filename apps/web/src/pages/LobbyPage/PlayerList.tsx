import type { CSSProperties } from "react";
import type { PlayerState } from "@anagrabble/protocol";
import { presenceLabel } from "../../presenceLabel";
import { cx } from "../../cx";
import styles from "./LobbyPage.module.css";

// Shared by WaitingRoomCard and JoinInProgressCard — the pre-game player
// roster with presence-derived "away" styling (see CLAUDE.md "Player
// presence: connected/disconnected tracking").
export function PlayerList({
  players,
  colors,
}: {
  players: PlayerState[];
  colors: Map<string, string>;
}) {
  return (
    <div className={styles.playerSection}>
      <div className={styles.playerSectionLabel}>
        {players.length === 1 ? "1 player at the table" : `${players.length} players at the table`}
      </div>
      <div className={styles.playerList}>
        {players.map((p) => {
          const label = presenceLabel(p.presence);
          return (
            <div
              key={p.id}
              className={cx(styles.playerRow, label && styles.playerRowMuted)}
              title={label ?? undefined}
            >
              <span
                className={cx(styles.playerDot, label && styles.playerDotMuted)}
                style={{ "--dot-color": colors.get(p.id) } as CSSProperties}
              />
              <span className={styles.playerName}>{p.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
