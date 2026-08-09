import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { PageShell, CenteredContent, NarrowColumn } from "../components/Layout";
import { useGameSocket } from "../useGameSocket";
import { getPlayerIdentity, setPlayerName } from "../playerIdentity";
import { makeCommandId } from "../gameId";
import { assignPlayerColors } from "../playerColors";
import { useCopyLink } from "../useCopyLink";
import { cx } from "../cx";
import { GameBoard } from "./GameBoard";
import styles from "./LobbyPage.module.css";

// Matches design-system/Lobby.dc.html — the live waiting room, and also the
// invite-link destination for players who haven't joined yet. There's no
// separate "preview then redirect" page: an unjoined guest sees the same
// lobby everyone else does, with a name field + Join button in place of
// "Waiting for the host…"; clicking Join updates this page in place once
// the server confirms membership, no navigation involved.

export function LobbyPage() {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const identity = useMemo(() => getPlayerIdentity(), []);
  const [starting, setStarting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [playerName, setPlayerNameField] = useState(identity.name);

  const { status, lobby, error, wordPlay, history, send } = useGameSocket(gameId, identity.id);

  const shareLink = `${window.location.origin}/${gameId}`;
  const { copied, copyLink } = useCopyLink(shareLink);

  const joinGame = () => {
    const name = playerName.trim() || identity.name;
    setPlayerName(name);
    setJoining(true);
    send({
      type: "JoinGame",
      commandId: makeCommandId(),
      gameId,
      playerId: identity.id,
      playerName: name,
    });
  };

  const startGame = () => {
    setStarting(true);
    send({
      type: "StartGame",
      commandId: makeCommandId(),
      gameId,
      hostId: identity.id,
    });
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
      </PageShell>
    );
  }

  // "ended" keeps rendering GameBoard too — otherwise a game that
  // auto-ends (CLAUDE.md "Game-end condition") would fall through to the
  // pre-game waiting-room view below (share link, "Start game" button),
  // which makes no sense for a game that's already over. GameBoard itself
  // shows the "Game over" message once lobby.status === "ended".
  if (lobby.status === "playing" || lobby.status === "ended") {
    return (
      <GameBoard
        lobby={lobby}
        playerId={identity.id}
        send={send}
        error={error}
        wordPlay={wordPlay}
        history={history}
      />
    );
  }

  const colors = assignPlayerColors(lobby.players, identity.id);
  const isHost = identity.id === lobby.hostId;
  const isJoined = lobby.players.some((p) => p.id === identity.id);
  const isUnjoinedGuest = !isHost && !isJoined;
  const host = lobby.players.find((p) => p.id === lobby.hostId);
  const subtitle = isHost
    ? "Send this link to whoever’s playing."
    : isUnjoinedGuest
      ? "You’re invited — add your name and join in."
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

            <div className={styles.playerSection}>
              <div className={styles.playerSectionLabel}>
                {lobby.players.length === 1
                  ? "1 player at the table"
                  : `${lobby.players.length} players at the table`}
              </div>
              <div className={styles.playerList}>
                {lobby.players.map((p) => (
                  <div key={p.id} className={styles.playerRow}>
                    <span className={styles.playerDot} style={{ background: colors.get(p.id) }} />
                    <span className={styles.playerName}>{p.name}</span>
                  </div>
                ))}
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
              <>
                <div className={styles.nameFieldWrap}>
                  <Input
                    label="Your name"
                    value={playerName}
                    onChange={(e) => setPlayerNameField(e.target.value)}
                    placeholder="Your name"
                  />
                </div>
                <Button
                  size="lg"
                  onClick={joinGame}
                  disabled={!playerName.trim() || status !== "open" || joining}
                  fullWidth
                >
                  {joining ? "Joining…" : "Join game"}
                </Button>
              </>
            )}
            {!isHost && isJoined && (
              <div className={styles.waitingText}>Waiting for the host to start the game…</div>
            )}
          </Card>
        </NarrowColumn>
      </CenteredContent>
    </PageShell>
  );
}
