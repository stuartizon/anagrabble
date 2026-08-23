import type { CSSProperties } from "react";
import type { LobbySnapshot } from "@anagrabble/protocol";
import { InviteCode } from "../../../components/InviteCode";
import { presenceLabel } from "../../../presenceLabel";
import { cx } from "../../../cx";
import styles from "./PlayersAndInviteSections.module.css";
import sharedStyles from "./shared.module.css";

/** Players/Invite/History — identical content for the desktop sidebar
 * (`<aside>`, always mounted, hidden below 840px by CSS) and the mobile
 * menu overlay (conditionally mounted, only above 840px unreachable).
 * Rendered as its own component so each call site gets its own element
 * tree/keys rather than one JSX value reused in two places.
 *
 * History is deliberately NOT part of this — design-system/In
 * Game.dc.html's mobileMenuOpen panel only ever has Players/Invite/Game
 * settings/Your settings, no history section, unlike the desktop
 * `<aside>` which has all three of Players/Invite/History. So the desktop
 * sidebar renders this plus its own History block (HistorySection); the
 * mobile overlay (MobileMenu) renders only this. */
export function PlayersAndInviteSections({
  lobby,
  colors,
  shareLink,
}: {
  lobby: LobbySnapshot;
  colors: Map<string, string>;
  shareLink: string;
}) {
  return (
    <>
      <div className={styles.playersSection}>
        <div className={sharedStyles.poolLabel}>Players</div>
        {lobby.players.map((p) => {
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

      <div>
        <InviteCode code={lobby.gameId} shareLink={shareLink} />
      </div>
    </>
  );
}
