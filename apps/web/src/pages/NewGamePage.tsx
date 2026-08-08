import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GameConfig } from "@anagrabble/protocol";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Select } from "../components/Select";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { useGameSocket } from "../useGameSocket";
import { getPlayerIdentity, setPlayerName } from "../playerIdentity";
import { makeCommandId, makeGameId } from "../gameId";

// Matches design-system/New Game.dc.html layout/copy. The dc.html prototype
// gates this page behind a login redirect; auth is out of scope here, so
// "Your name" is a plain editable field backed by the local player-identity
// stub instead.

const TURN_TIMER_OPTIONS = [
  { label: "15 seconds", value: "15" },
  { label: "30 seconds", value: "30" },
  { label: "45 seconds", value: "45" },
  { label: "60 seconds", value: "60" },
];
const MIN_WORD_LENGTH_OPTIONS = [
  { label: "3 letters", value: "3" },
  { label: "4 letters", value: "4" },
  { label: "5 letters", value: "5" },
];
const LANGUAGE_OPTIONS = [
  { label: "English", value: "English" },
  { label: "Spanish", value: "Spanish" },
  { label: "French", value: "French" },
];

export function NewGamePage() {
  const navigate = useNavigate();
  const identity = useMemo(() => getPlayerIdentity(), []);
  const [playerName, setPlayerNameField] = useState(identity.name);
  const [turnTimer, setTurnTimer] = useState("30");
  const [minWordLength, setMinWordLength] = useState("3");
  const [language, setLanguage] = useState("English");
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);

  const { status, lobby, error, send } = useGameSocket();

  useEffect(() => {
    if (pendingGameId && lobby?.gameId === pendingGameId) {
      navigate(`/${lobby.gameId}`);
    }
  }, [lobby, pendingGameId, navigate]);

  useEffect(() => {
    if (error) setPendingGameId(null);
  }, [error]);

  const createGame = () => {
    const name = playerName.trim() || identity.name;
    setPlayerName(name);
    const gameId = makeGameId();
    const config: GameConfig = {
      turnTimerSec: Number(turnTimer),
      minWordLength: Number(minWordLength),
      language,
    };
    setPendingGameId(gameId);
    send({
      type: "CreateGame",
      commandId: makeCommandId(),
      gameId,
      hostId: identity.id,
      hostName: name,
      config,
    });
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <Card>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "var(--text-xl)",
                color: "var(--ink)",
                marginBottom: 4,
              }}
            >
              New game
            </div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                marginBottom: 20,
              }}
            >
              Set the rules, then share the link with your players.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGE_OPTIONS} />
              <Select
                label="Minimum word length"
                value={minWordLength}
                onChange={(e) => setMinWordLength(e.target.value)}
                options={MIN_WORD_LENGTH_OPTIONS}
              />
              <Select label="Turn timer" value={turnTimer} onChange={(e) => setTurnTimer(e.target.value)} options={TURN_TIMER_OPTIONS} />
              <Input label="Your name" value={playerName} onChange={(e) => setPlayerNameField(e.target.value)} placeholder="Your name" />
            </div>
            {error && <div style={{ marginTop: 12, fontSize: "var(--text-sm)", color: "var(--error)" }}>{error.message}</div>}
            <div style={{ marginTop: 24 }}>
              <Button
                size="lg"
                onClick={createGame}
                disabled={!playerName.trim() || status !== "open" || !!pendingGameId}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {pendingGameId ? "Creating…" : "Create game"}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
