import type { GameSnapshot } from "@anagrabble/protocol";
import { Header } from "../../components/Header";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { GameConfigList } from "../../components/GameConfigList";
import { InviteCode } from "../../components/InviteCode";
import { PageShell, PageContent, NarrowColumn } from "../../components/Layout";
import { RulesLink } from "../../components/RulesLink";
import type { SocketStatus } from "../../hooks/useGameSocket";
import { assignPlayerColors } from "../../utils/playerColors";
import { PlayerList } from "./PlayerList";
import styles from "./WaitingRoomCard.module.css";
import sharedStyles from "./shared.module.css";

interface WaitingRoomCardProps {
  game: GameSnapshot;
  playerId: string;
  status: SocketStatus;
  gameId: string;
  shareLink: string;
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
// GamePage/index.tsx's top-of-file comment for why there's no separate
// preview screen.
export function WaitingRoomCard({
  game,
  playerId,
  status,
  shareLink,
  gameId,
  starting,
  joining,
  leaving,
  leaveError,
  onStart,
  onJoin,
  onLeave,
}: WaitingRoomCardProps) {
  const colors = assignPlayerColors(game.players, playerId);
  const isHost = playerId === game.hostId;
  const isJoined = game.players.some((p) => p.id === playerId);
  const isUnjoinedGuest = !isHost && !isJoined;
  const canJoin = status === "open";

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

            <GameConfigList config={game.config} />

            <div className={sharedStyles.rulesLinkRow}>
              <RulesLink />
            </div>

            <PlayerList players={game.players} colors={colors} />

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
