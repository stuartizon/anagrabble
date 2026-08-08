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
import { cx } from "../cx";
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
  const [copied, setCopied] = useState(false);
  const [startClicked, setStartClicked] = useState(false);
  const [joining, setJoining] = useState(false);
  const [playerName, setPlayerNameField] = useState(identity.name);

  const { status, lobby, error, send } = useGameSocket(gameId, identity.id);

  const shareLink = `${window.location.origin}/${gameId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

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

  if (error) {
    return (
      <PageShell>
        <Header />
        <CenteredContent>
          <NarrowColumn>
            <Card>
              <div className={cx(styles.title, styles.notFoundTitleOverride)}>Game not found</div>
              <div className={styles.notFoundBody}>This link may have expired, or the game already ended.</div>
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

  const isHost = identity.id === lobby.hostId;
  const isJoined = lobby.players.some((p) => p.id === identity.id);
  const isUnjoinedGuest = !isHost && !isJoined;
  const canStart = lobby.players.length >= 2;
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
                {copied ? <Check size={18} color="var(--text-muted)" /> : <Copy size={18} color="var(--text-muted)" />}
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
                {lobby.players.length === 1 ? "1 player at the table" : `${lobby.players.length} players at the table`}
              </div>
              <div className={styles.playerList}>
                {lobby.players.map((p) => (
                  <div key={p.id} className={styles.playerRow}>
                    <span className={styles.playerDot} style={{ background: p.color }} />
                    <span className={styles.playerName}>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {isHost && (
              <>
                <Button
                  size="lg"
                  disabled={!canStart}
                  onClick={() => setStartClicked(true)}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {canStart ? "Start game" : "Waiting for players…"}
                </Button>
                {startClicked && <div className={styles.startHint}>Starting the game is coming in the next slice — not wired up yet.</div>}
              </>
            )}
            {isUnjoinedGuest && (
              <>
                <div className={styles.nameFieldWrap}>
                  <Input label="Your name" value={playerName} onChange={(e) => setPlayerNameField(e.target.value)} placeholder="Your name" />
                </div>
                <Button
                  size="lg"
                  onClick={joinGame}
                  disabled={!playerName.trim() || status !== "open" || joining}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {joining ? "Joining…" : "Join game"}
                </Button>
              </>
            )}
            {!isHost && isJoined && <div className={styles.waitingText}>Waiting for the host to start the game…</div>}
          </Card>
        </NarrowColumn>
      </CenteredContent>
    </PageShell>
  );
}
