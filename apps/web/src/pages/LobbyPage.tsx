import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth, useUser } from "../auth";
import { Check, Copy, WifiOff } from "lucide-react";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { PageShell, CenteredContent, NarrowColumn } from "../components/Layout";
import { RulesLink } from "../components/RulesLink";
import { Loader } from "../components/Loader";
import { useGameSocket } from "../useGameSocket";
import { getDisplayName } from "../clerkDisplayName";
import { makeCommandId } from "../gameId";
import { assignPlayerColors } from "../playerColors";
import { useCopyLink } from "../useCopyLink";
import { leaveGame as leaveGameRequest } from "../fetchLeaveGame";
import { presenceLabel } from "../presenceLabel";
import { cx } from "../cx";
import { GameBoard } from "./GameBoard";
import { GameOverSummary } from "./GameOverSummary";
import styles from "./LobbyPage.module.css";

// Matches design-system/Lobby.dc.html — the live waiting room, and also the
// invite-link destination for players who haven't joined yet (RequireAuth
// sends a signed-out visitor through /login first). There's no separate
// "preview then redirect" page: an unjoined guest sees the same lobby
// everyone else does, with a Join button in place of "Waiting for the
// host…"; clicking Join updates this page in place once the server
// confirms membership, no navigation involved.

export function LobbyPage() {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const { userId, getToken } = useAuth();
  const { user } = useUser();
  const playerName = getDisplayName(user);
  const [starting, setStarting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const { status, lobby, error, wordPlay, history, send } = useGameSocket(gameId);

  const shareLink = `${window.location.origin}/${gameId}`;
  const { copied, copyLink } = useCopyLink(shareLink);

  const joinGame = () => {
    setJoining(true);
    send({
      type: "JoinGame",
      commandId: makeCommandId(),
      gameId,
      playerName,
    });
  };

  const startGame = () => {
    setStarting(true);
    send({
      type: "StartGame",
      commandId: makeCommandId(),
      gameId,
    });
  };

  // A deliberate, explicit leave — REST rather than a WS command, and
  // pre-start only (the button is only ever rendered from the lobby view
  // below). See docs/decisions.md "Player presence:
  // connected/disconnected/left tracking" for why this doesn't go through
  // the same debounced-disconnect path a dropped connection does.
  const leaveGame = async () => {
    setLeaving(true);
    setLeaveError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Unauthorized");
      await leaveGameRequest(token, gameId);
      navigate("/");
    } catch {
      setLeaveError("Something went wrong leaving the game. Try again.");
      setLeaving(false);
    }
  };

  // Only a missing game warrants replacing the whole page — every other
  // error code (NotHost, a rejected word, a stale-state retry, ...) means
  // the game itself is fine and should be shown inline near whatever
  // command produced it, not swap out the page it happened on.
  if (error?.code === "GameNotFound") {
    return (
      <PageShell>
        <Header />
        <CenteredContent>
          <NarrowColumn>
            <Card>
              <div className={cx(styles.title, styles.notFoundTitleOverride)}>Game not found</div>
              <div className={styles.notFoundBody}>
                This link may have expired, or the game already ended.
              </div>
              <Button onClick={() => navigate("/")}>Back home</Button>
            </Card>
          </NarrowColumn>
        </CenteredContent>
      </PageShell>
    );
  }

  if (!lobby) {
    return (
      <PageShell>
        <Header />
        <CenteredContent>
          <Loader />
        </CenteredContent>
      </PageShell>
    );
  }

  // "ended" renders its own summary screen rather than falling through to
  // the pre-game waiting-room view below (share link, "Start game" button),
  // which makes no sense for a game that's already over — see
  // GameOverSummary, matching design-system/Game Over.dc.html.
  if (lobby.status === "ended") {
    return <GameOverSummary lobby={lobby} playerId={userId!} />;
  }

  const colors = assignPlayerColors(lobby.players, userId!);
  const isHost = userId === lobby.hostId;
  const isJoined = lobby.players.some((p) => p.id === userId);
  const isUnjoinedGuest = !isHost && !isJoined;

  // A guest who opens a mid-game invite link without ever calling JoinGame
  // is otherwise just as "transport-ready" as anyone else — the WS connect
  // already hands them a live-updating LobbySnapshot regardless of when it
  // happens — but they can't do anything with it (apply_submit_word.lua
  // rejects a submitter who isn't a recognized player). Gate the board
  // behind the same join prompt the pre-start lobby already uses, rather
  // than exposing a live read-only spectator view. See docs/decisions.md
  // "Mid-game join: scope decisions".
  if (lobby.status === "playing" && isUnjoinedGuest) {
    return (
      <PageShell>
        <Header />
        <CenteredContent>
          <NarrowColumn>
            <Card>
              <div className={styles.title}>Join this game</div>
              <div className={styles.subtitle}>This game’s already in progress — join in.</div>

              <div className={styles.configList}>
                <div className={styles.configRow}>
                  <span className={styles.configLabel}>Language</span>
                  <span className={styles.configValue}>{lobby.config.language}</span>
                </div>
                <div className={styles.configRow}>
                  <span className={styles.configLabel}>Minimum word length</span>
                  <span className={styles.configValue}>{lobby.config.minWordLength} letters</span>
                </div>
                <div className={cx(styles.configRow, styles.configRowLastOverride)}>
                  <span className={styles.configLabel}>Turn timer</span>
                  <span className={styles.configValue}>{lobby.config.turnTimerSec}s</span>
                </div>
              </div>

              <div className={styles.rulesLinkRow}>
                <RulesLink />
              </div>

              <div className={styles.playerSection}>
                <div className={styles.playerSectionLabel}>
                  {lobby.players.length === 1
                    ? "1 player at the table"
                    : `${lobby.players.length} players at the table`}
                </div>
                <div className={styles.playerList}>
                  {lobby.players.map((p) => {
                    const label = presenceLabel(p.presence);
                    return (
                      <div
                        key={p.id}
                        className={cx(styles.playerRow, label && styles.playerRowMuted)}
                      >
                        <span
                          className={styles.playerDot}
                          style={{ background: colors.get(p.id) }}
                        />
                        <span className={styles.playerName}>{p.name}</span>
                        {label && (
                          <WifiOff size={14} color="var(--text-muted)" aria-label={label} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <Button
                size="lg"
                onClick={joinGame}
                disabled={status !== "open" || joining}
                fullWidth
              >
                {joining ? "Joining…" : "Join game"}
              </Button>
            </Card>
          </NarrowColumn>
        </CenteredContent>
      </PageShell>
    );
  }

  if (lobby.status === "playing") {
    return (
      <GameBoard
        lobby={lobby}
        playerId={userId!}
        send={send}
        error={error}
        wordPlay={wordPlay}
        history={history}
        status={status}
      />
    );
  }

  const host = lobby.players.find((p) => p.id === lobby.hostId);
  const subtitle = isHost
    ? "Send this link to whoever’s playing."
    : isUnjoinedGuest
      ? "You’re invited — join in."
      : "Waiting for more players to join.";

  return (
    <PageShell>
      <Header />
      <CenteredContent>
        <NarrowColumn>
          <Card>
            <div className={styles.title}>{host?.name ?? "Someone"}&rsquo;s game</div>
            <div className={styles.subtitle}>{subtitle}</div>

            <div className={styles.shareLinkRow}>
              <span className={styles.shareLinkText}>{shareLink}</span>
              <button className={styles.copyButton} onClick={copyLink} aria-label="Copy link">
                {copied ? (
                  <Check size={18} color="var(--text-muted)" />
                ) : (
                  <Copy size={18} color="var(--text-muted)" />
                )}
              </button>
            </div>

            <div className={styles.configList}>
              <div className={styles.configRow}>
                <span className={styles.configLabel}>Language</span>
                <span className={styles.configValue}>{lobby.config.language}</span>
              </div>
              <div className={styles.configRow}>
                <span className={styles.configLabel}>Minimum word length</span>
                <span className={styles.configValue}>{lobby.config.minWordLength} letters</span>
              </div>
              <div className={cx(styles.configRow, styles.configRowLastOverride)}>
                <span className={styles.configLabel}>Turn timer</span>
                <span className={styles.configValue}>{lobby.config.turnTimerSec}s</span>
              </div>
            </div>

            <div className={styles.rulesLinkRow}>
              <RulesLink />
            </div>

            <div className={styles.playerSection}>
              <div className={styles.playerSectionLabel}>
                {lobby.players.length === 1
                  ? "1 player at the table"
                  : `${lobby.players.length} players at the table`}
              </div>
              <div className={styles.playerList}>
                {lobby.players.map((p) => {
                  const label = presenceLabel(p.presence);
                  return (
                    <div
                      key={p.id}
                      className={cx(styles.playerRow, label && styles.playerRowMuted)}
                    >
                      <span className={styles.playerDot} style={{ background: colors.get(p.id) }} />
                      <span className={styles.playerName}>{p.name}</span>
                      {label && <WifiOff size={14} color="var(--text-muted)" aria-label={label} />}
                    </div>
                  );
                })}
              </div>
            </div>

            {isHost && (
              <>
                <div className={styles.startHint}>Start once everyone at the table has joined.</div>
                <Button size="lg" disabled={starting} onClick={startGame} fullWidth>
                  {starting ? "Starting…" : "Start game"}
                </Button>
              </>
            )}
            {isUnjoinedGuest && (
              <Button
                size="lg"
                onClick={joinGame}
                disabled={status !== "open" || joining}
                fullWidth
              >
                {joining ? "Joining…" : "Join game"}
              </Button>
            )}
            {!isHost && isJoined && (
              <div className={styles.waitingText}>Waiting for the host to start the game…</div>
            )}
            {isJoined && (
              <div className={styles.leaveRow}>
                <Button variant="ghost" size="lg" disabled={leaving} onClick={leaveGame} fullWidth>
                  {leaving ? "Leaving…" : "Leave game"}
                </Button>
              </div>
            )}
            {leaveError && <div className={styles.errorText}>{leaveError}</div>}
          </Card>
        </NarrowColumn>
      </CenteredContent>
    </PageShell>
  );
}
