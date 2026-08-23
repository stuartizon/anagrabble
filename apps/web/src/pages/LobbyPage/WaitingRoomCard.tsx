import type { LobbySnapshot } from "@anagrabble/protocol";
import { Header } from "../../components/Header";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { GameConfigList } from "../../components/GameConfigList";
import { InviteCode } from "../../components/InviteCode";
import { PageShell, PageContent, NarrowColumn } from "../../components/Layout";
import { RulesLink } from "../../components/RulesLink";
import { PlayerList } from "./PlayerList";
import styles from "./WaitingRoomCard.module.css";
import sharedStyles from "./shared.module.css";

interface WaitingRoomCardProps {
  lobby: LobbySnapshot;
  colors: Map<string, string>;
  gameId: string;
  shareLink: string;
  isHost: boolean;
  isJoined: boolean;
  isUnjoinedGuest: boolean;
  canJoin: boolean;
  starting: boolean;
  joining: boolean;
  leaving: boolean;
  leaveError: string | null;
  onStart: () => void;
  onJoin: () => void;
  onLeave: () => void;
}

// The pre-start waiting room: share link, game config, player roster, and
// whichever of Start/Join/Leave applies to the viewer. Also doubles as the
// invite-link destination for a guest who hasn't joined yet — see
// LobbyPage/index.tsx's top-of-file comment for why there's no separate
// preview screen.
export function WaitingRoomCard({
  lobby,
  colors,
  shareLink,
  gameId,
  isHost,
  isJoined,
  isUnjoinedGuest,
  canJoin,
  starting,
  joining,
  leaving,
  leaveError,
  onStart,
  onJoin,
  onLeave,
}: WaitingRoomCardProps) {
  const subtitle = isHost
    ? "Send this link to whoever’s playing."
    : isUnjoinedGuest
      ? "You’re invited — join in."
      : "Waiting for more players to join.";

  return (
    <PageShell>
      <Header />
      <PageContent>
        <NarrowColumn>
          <Card>
            <div className={sharedStyles.title}>New game</div>
            <div className={sharedStyles.subtitle}>{subtitle}</div>

            <div className={styles.shareLinkRow}>
              <InviteCode code={gameId} shareLink={shareLink} />
            </div>

            <GameConfigList config={lobby.config} />

            <div className={sharedStyles.rulesLinkRow}>
              <RulesLink />
            </div>

            <PlayerList players={lobby.players} colors={colors} />

            {isHost && (
              <>
                <div className={styles.startHint}>Start once everyone at the table has joined.</div>
                <Button size="lg" disabled={starting} onClick={onStart} fullWidth>
                  {starting ? "Starting…" : "Start game"}
                </Button>
              </>
            )}
            {isUnjoinedGuest && (
              <Button size="lg" onClick={onJoin} disabled={!canJoin || joining} fullWidth>
                {joining ? "Joining…" : "Join game"}
              </Button>
            )}
            {!isHost && isJoined && (
              <div className={styles.waitingText}>Waiting for the host to start the game…</div>
            )}
            {isJoined && (
              <div className={styles.leaveRow}>
                <Button variant="ghost" size="lg" disabled={leaving} onClick={onLeave} fullWidth>
                  {leaving ? "Leaving…" : "Leave game"}
                </Button>
              </div>
            )}
            {leaveError && <div className={styles.errorText}>{leaveError}</div>}
          </Card>
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}
