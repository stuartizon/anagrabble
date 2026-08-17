import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, useUser } from "../auth";
import type { GameConfig } from "@anagrabble/protocol";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Select } from "../components/Select";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { RulesLink } from "../components/RulesLink";
import { PageShell, PageContent, NarrowColumn } from "../components/Layout";
import { createGame as createGameRequest, CreateGameError } from "../fetchCreateGame";
import { getDisplayName } from "../clerkDisplayName";
import styles from "./NewGamePage.module.css";

// Matches design-system/New Game.dc.html layout/copy. RequireAuth gates
// this route on being signed in, so "Your name" is the player's Clerk
// account name rather than an editable field.
//
// CreateGame is a plain POST /games rather than a WS command — see
// docs/decisions.md "CreateGame as a REST endpoint": unlike every other
// gameplay command, there's no other connected client to broadcast a new
// game's creation to, so this doesn't need a pre-opened WS connection just
// to send one message over. That also means "Create game" no longer needs
// to wait on a socket handshake before it's clickable — it's disabled only
// while the request itself is in flight, an ordinary form submit.

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

// gameId is server-generated now (see docs/decisions.md "CreateGame as a
// REST endpoint") — a collision on the server's own choice is retried
// internally, so there's no client-visible "that id is taken" case left to
// give a specific message for.
const CREATE_GAME_ERROR = "Something went wrong creating your game. Try again.";

export function NewGamePage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { getToken } = useAuth();
  const hostName = getDisplayName(user);
  const [turnTimer, setTurnTimer] = useState("30");
  const [minWordLength, setMinWordLength] = useState("3");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createGame = async () => {
    setCreating(true);
    setError(null);

    const config: GameConfig = {
      turnTimerSec: Number(turnTimer),
      minWordLength: Number(minWordLength),
      language: LANGUAGE,
    };

    try {
      const token = await getToken();
      if (!token) throw new CreateGameError("Unauthorized");
      const snapshot = await createGameRequest(token, { hostName, config });
      navigate(`/${snapshot.gameId}`);
    } catch {
      setError(CREATE_GAME_ERROR);
      setCreating(false);
    }
  };

  return (
    <PageShell>
      <Header />
      <PageContent>
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
            {error && <div className={styles.errorText}>{error}</div>}
            <div className={styles.buttonRow}>
              <Button onClick={createGame} disabled={creating} size="lg" fullWidth>
                {creating ? "Creating…" : "Create game"}
              </Button>
            </div>
          </Card>
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}
