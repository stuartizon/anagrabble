import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../auth";
import type { GameConfig } from "@anagrabble/protocol";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Select } from "../components/Select";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { RulesLink } from "../components/RulesLink";
import { PageShell, CenteredContent, NarrowColumn } from "../components/Layout";
import { useGameSocket } from "../useGameSocket";
import { getDisplayName } from "../clerkDisplayName";
import { makeCommandId, makeGameId } from "../gameId";
import styles from "./NewGamePage.module.css";

// Matches design-system/New Game.dc.html layout/copy. RequireAuth gates
// this route on being signed in, so "Your name" is the player's Clerk
// account name rather than an editable field.

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
const LANGUAGE = "English";

export function NewGamePage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const hostName = getDisplayName(user);
  const [turnTimer, setTurnTimer] = useState("30");
  const [minWordLength, setMinWordLength] = useState("3");
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
    const gameId = makeGameId();
    const config: GameConfig = {
      turnTimerSec: Number(turnTimer),
      minWordLength: Number(minWordLength),
      language: LANGUAGE,
    };
    setPendingGameId(gameId);
    send({
      type: "CreateGame",
      commandId: makeCommandId(),
      gameId,
      hostName,
      config,
    });
  };

  return (
    <PageShell>
      <Header />
      <CenteredContent>
        <NarrowColumn>
          <Card>
            <div className={styles.title}>New game</div>
            <div className={styles.subtitle}>
              Set the rules, then share the link with your players.
            </div>
            <div className={styles.fieldStack}>
              <Input label="Language" value={LANGUAGE} disabled />
              <Select
                label="Minimum word length"
                value={minWordLength}
                onChange={(e) => setMinWordLength(e.target.value)}
                options={MIN_WORD_LENGTH_OPTIONS}
              />
              <Select
                label="Turn timer"
                value={turnTimer}
                onChange={(e) => setTurnTimer(e.target.value)}
                options={TURN_TIMER_OPTIONS}
              />
            </div>
            <div className={styles.rulesLinkRow}>
              <RulesLink />
            </div>
            {error && <div className={styles.errorText}>{error.message}</div>}
            <div className={styles.buttonRow}>
              <Button
                size="lg"
                onClick={createGame}
                disabled={status !== "open" || !!pendingGameId}
                fullWidth
              >
                {pendingGameId ? "Creating…" : "Create game"}
              </Button>
            </div>
          </Card>
        </NarrowColumn>
      </CenteredContent>
    </PageShell>
  );
}
