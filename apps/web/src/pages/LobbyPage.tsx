import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { useGameSocket } from "../useGameSocket";
import { getPlayerIdentity, setPlayerName } from "../playerIdentity";
import { makeCommandId } from "../gameId";

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
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Header />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
          <div style={{ width: "100%", maxWidth: 420 }}>
            <Card>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-xl)", color: "var(--ink)", marginBottom: 8 }}>
                Game not found
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--text-base)", color: "var(--text-secondary)", marginBottom: 20 }}>
                This link may have expired, or the game already ended.
              </div>
              <Button onClick={() => navigate("/")}>Back home</Button>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (!lobby) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Header />
      </div>
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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <Card>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-xl)", color: "var(--ink)", marginBottom: 12 }}>
              {host?.name ?? "Someone"}&rsquo;s game
            </div>

            <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 12 }}>
              {subtitle}
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                background: "var(--surface-sunken)",
                marginBottom: 20,
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-sm)",
                  color: "var(--ink)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {shareLink}
              </span>
              <button
                onClick={copyLink}
                aria-label="Copy link"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", flexShrink: 0 }}
              >
                {copied ? (
                  <Check style={{ width: 18, height: 18, color: "var(--text-muted)" }} />
                ) : (
                  <Copy style={{ width: 18, height: 18, color: "var(--text-muted)" }} />
                )}
              </button>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginBottom: 20,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
              }}
            >
              <ConfigRow label="Language" value={lobby.config.language} />
              <ConfigRow label="Minimum word length" value={`${lobby.config.minWordLength} letters`} />
              <ConfigRow label="Turn timer" value={`${lobby.config.turnTimerSec}s`} last />
            </div>

            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: "var(--text-sm)",
                  letterSpacing: "var(--tracking-wider)",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                {lobby.players.length === 1 ? "1 player at the table" : `${lobby.players.length} players at the table`}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {lobby.players.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 2px 6px" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "2px", background: p.color, flexShrink: 0 }} />
                    <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--ink)" }}>
                      {p.name}
                    </span>
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
                {startClicked && (
                  <div style={{ textAlign: "center", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 10 }}>
                    Starting the game is coming in the next slice — not wired up yet.
                  </div>
                )}
              </>
            )}
            {isUnjoinedGuest && (
              <>
                <div style={{ marginBottom: 16 }}>
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
            {!isHost && isJoined && (
              <div style={{ textAlign: "center", fontFamily: "var(--font-body)", fontSize: "var(--text-sm)", color: "var(--text-muted)", padding: "12px 0" }}>
                Waiting for the host to start the game…
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: last ? "none" : "1px solid var(--border)",
        background: "var(--surface-sunken)",
      }}
    >
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--ink)" }}>{value}</span>
    </div>
  );
}
