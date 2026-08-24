import type { CSSProperties } from "react";
import type { GameSnapshot } from "@anagrabble/protocol";
import { presenceLabel } from "../../../utils/presenceLabel";
import { cx } from "../../../utils/cx";
import styles from "./PlayersSection.module.css";
import sharedStyles from "./shared.module.css";

/** The player roster — used by both the desktop sidebar (`<aside>`, always
 * mounted, hidden below 840px by CSS) and the mobile menu overlay
 * (conditionally mounted, only above 840px unreachable). Rendered as its
 * own component so each call site gets its own element tree/keys rather
 * than one JSX value reused in two places.
 *
 * Invite (`InviteCode`) used to be bundled in here too, but the two call
 * sites now want it in different positions relative to Players/settings —
 * the desktop sidebar keeps Players/Invite adjacent (design-system/In
 * Game.dc.html's `<aside>`), while the mobile menu puts "Your settings"
 * ahead of Invite (a design-perspective reorder, not in the source design —
 * see anagrabble#40's follow-up) — so each call site renders `InviteCode`
 * itself, wherever it belongs for that surface. */
export function PlayersSection({
  game,
  colors,
}: {
  game: GameSnapshot;
  colors: Map<string, string>;
}) {
  return (
    <div className={styles.playersSection}>
      <div className={sharedStyles.poolLabel}>Players</div>
      {game.players.map((p) => {
        const label = presenceLabel(p.presence);
        // Design (In Game.dc.html) hollows out the swatch to a colored
        // ring rather than fully greying it out, so the player's color
        // stays identifiable even while they're not connected. Combined
        // with the row's own opacity dip (playerRowMuted), that's enough
        // to read as "away" without a separate icon/text badge — see
        // docs/decisions.md "Player presence: connected/disconnected
        // tracking".
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
            <span className={styles.playerName} data-testid="sidebar-player-name">
              {p.name}
            </span>
            <span className={styles.playerScore}>{p.score}</span>
          </div>
        );
      })}
    </div>
  );
}
