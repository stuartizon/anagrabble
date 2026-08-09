import { useEffect, useRef, useState } from "react";
import type { Command, LobbySnapshot } from "@anagrabble/protocol";
import { Header } from "../components/Header";
import { PageShell, CenteredContent } from "../components/Layout";
import { makeCommandId } from "../gameId";
import { cx } from "../cx";
import styles from "./GameBoard.module.css";

// Minimal slice of design-system/In Game.dc.html: just enough for "turn over
// one tile from the bank on my turn" (docs/user-stories.md). Word
// submission/stealing, history, and the settings/menu chrome are separate
// stories and land later.

interface GameBoardProps {
  lobby: LobbySnapshot;
  playerId: string;
  send: (command: Command) => void;
}

function remainingSeconds(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

export function GameBoard({ lobby, playerId, send }: GameBoardProps) {
  const currentPlayer = lobby.players[lobby.turnPlayerIndex];
  const isCurrentPlayer = currentPlayer?.id === playerId;
  const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(lobby.turnDeadline));
  // Guards against every tick after a missed deadline re-firing TurnTile —
  // once we've fired for a given deadline value, wait for the server to
  // hand us a new one (see CLAUDE.md "Turn timer enforcement": any client
  // may trigger it, the server is what actually enforces "just once").
  const firedForDeadline = useRef<number | null>(null);

  const turnDeadline = lobby.turnDeadline;
  const gameId = lobby.gameId;

  useEffect(() => {
    setSecondsLeft(remainingSeconds(turnDeadline));
    firedForDeadline.current = null;
    if (turnDeadline === null || lobby.bankCount <= 0) return;

    const interval = setInterval(() => {
      setSecondsLeft(remainingSeconds(turnDeadline));
      if (Date.now() >= turnDeadline && firedForDeadline.current !== turnDeadline) {
        firedForDeadline.current = turnDeadline;
        send({ type: "TurnTile", commandId: makeCommandId(), gameId, playerId });
      }
    }, 250);

    return () => clearInterval(interval);
  }, [turnDeadline, gameId, playerId, send, lobby.bankCount]);

  const turnTile = () => {
    send({ type: "TurnTile", commandId: makeCommandId(), gameId, playerId });
  };

  return (
    <PageShell>
      <Header />
      <CenteredContent>
        <div className={styles.board}>
          <div className={styles.topRow}>
            <div className={styles.bankCount}>{lobby.bankCount} tiles left</div>
          </div>

          <div className={styles.playersRow}>
            {lobby.players.map((p, i) => (
              <div
                key={p.id}
                className={cx(
                  styles.playerChip,
                  i === lobby.turnPlayerIndex && styles.playerChipActive,
                )}
              >
                <span className={styles.playerDot} style={{ background: p.color }} />
                <span className={styles.playerName}>{p.name}</span>
              </div>
            ))}
          </div>

          <div>
            <div className={styles.poolLabel}>Upturned tiles</div>
            <div className={styles.poolTiles}>
              {lobby.pool.length === 0 && (
                <span className={styles.poolEmpty}>No tiles turned yet.</span>
              )}
              {lobby.pool.map((letter, i) => (
                <span key={i} className={styles.tile}>
                  {letter}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.turnSection}>
            {lobby.bankCount <= 0 ? (
              <div className={styles.turnHint}>The bank is empty.</div>
            ) : isCurrentPlayer ? (
              <button className={styles.turnButton} onClick={turnTile}>
                Turn a tile ({secondsLeft}s)
              </button>
            ) : (
              <div className={styles.turnHint}>
                Waiting on {currentPlayer?.name ?? "…"} ({secondsLeft}s)
              </div>
            )}
          </div>
        </div>
      </CenteredContent>
    </PageShell>
  );
}
