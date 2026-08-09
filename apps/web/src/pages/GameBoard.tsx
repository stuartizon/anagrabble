import { useEffect, useRef, useState } from "react";
import type { Command, LobbySnapshot } from "@anagrabble/protocol";
import { Header } from "../components/Header";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { makeCommandId } from "../gameId";
import { assignPlayerColors } from "../playerColors";
import { cx } from "../cx";
import type { GameSocketError, WordPlayNarration } from "../useGameSocket";
import styles from "./GameBoard.module.css";

// Minimal slice of design-system/In Game.dc.html: tile-turning, word
// submission, and enough word-list/narration feedback to make a play feel
// like it did something. History log and the settings/menu chrome are
// separate stories and land later.

interface GameBoardProps {
  lobby: LobbySnapshot;
  playerId: string;
  send: (command: Command) => void;
  error: GameSocketError | null;
  wordPlay: WordPlayNarration | null;
}

function remainingSeconds(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/** Player-facing copy for a rejected SubmitWord, or `null` to show nothing.
 * `NoDecomposition` deliberately doesn't say "letters" — it covers every way
 * a play can be currently illegal (pool-only insufficient, a steal that's
 * actually just a blocked derivation, a bare zero-addition resubmission,
 * ...), not just "the upturned tiles don't have it". `NotYourTurn` is
 * suppressed rather than mapped: the only way it can reach this component is
 * the turn-timer effect's own background TurnTile auto-fire losing a race
 * against another client (see that effect below) — the UI never lets a
 * player deliberately click "Turn a tile" when it isn't their turn, so this
 * is never a rejection of something the player actually did. */
function errorText(
  code: string,
  minWordLength: number,
  attemptedWord: string,
  fallback: string,
): string | null {
  switch (code) {
    case "NotAWord":
      return `${attemptedWord.toUpperCase()} isn't in the dictionary.`;
    case "TooShort":
      return `Words need to be at least ${minWordLength} letters.`;
    case "NoDecomposition":
      return "That's not a legal move right now.";
    case "WordAlreadyClaimed":
      return "That word is already taken.";
    case "StaleState":
      return "The board just changed — try again.";
    case "NotYourTurn":
      return null;
    default:
      return fallback;
  }
}

function playerName(lobby: LobbySnapshot, viewerId: string, id: string): string {
  if (id === viewerId) return "You";
  return lobby.players.find((p) => p.id === id)?.name ?? "Someone";
}

/** "Sam stole CAT from You -> CAST" — CLAUDE.md "Core gameplay"'s narration
 * style. Only called a steal when the used word actually belonged to
 * someone else; extending your own word or a fresh pool play both just say
 * "played". */
function narrate(lobby: LobbySnapshot, viewerId: string, play: WordPlayNarration): string {
  const actor = playerName(lobby, viewerId, play.playerId);
  const stolen = play.usedWords.find((w) => w.ownerId !== play.playerId);
  if (stolen) {
    const owner = playerName(lobby, viewerId, stolen.ownerId);
    return `${actor} stole ${stolen.word} from ${owner} → ${play.word}`;
  }
  return `${actor} played ${play.word}`;
}

const MESSAGE_DISMISS_MS = 2500;

export function GameBoard({ lobby, playerId, send, error, wordPlay }: GameBoardProps) {
  const colors = assignPlayerColors(lobby.players, playerId);
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

  const [wordValue, setWordValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // The input is cleared optimistically on submit (below), so by the time an
  // Error event comes back asynchronously, wordValue itself no longer has
  // what was attempted. Keyed by commandId (round-tripped on ErrorEvent)
  // rather than just remembering "the last one" — a player submitting twice
  // before the first rejection comes back must still get the right word
  // named in the right message, not whichever was typed most recently.
  const pendingWordsRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!wordPlay) return;
    setMessage(narrate(lobby, playerId, wordPlay));
    const timer = setTimeout(() => setMessage(null), MESSAGE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [wordPlay, lobby, playerId]);

  useEffect(() => {
    if (!error) return;
    const attemptedWord = error.commandId
      ? (pendingWordsRef.current.get(error.commandId) ?? "")
      : "";
    if (error.commandId) pendingWordsRef.current.delete(error.commandId);
    const text = errorText(error.code, lobby.config.minWordLength, attemptedWord, error.message);
    if (text === null) return;
    setMessage(text);
    const timer = setTimeout(() => setMessage(null), MESSAGE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [error, lobby.config.minWordLength]);

  const submitWord = (e: React.FormEvent) => {
    e.preventDefault();
    const word = wordValue.trim();
    if (!word) return;
    const commandId = makeCommandId();
    pendingWordsRef.current.set(commandId, word);
    send({ type: "SubmitWord", commandId, gameId, playerId, word });
    setWordValue("");
  };

  const me = lobby.players.find((p) => p.id === playerId);
  const others = lobby.players.filter((p) => p.id !== playerId);

  return (
    <div className={styles.page}>
      <Header />

      <div className={styles.scrollArea}>
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
                <span className={styles.playerDot} style={{ background: colors.get(p.id) }} />
                <span className={styles.playerName}>{p.name}</span>
                <span className={styles.playerScore}>{p.score}</span>
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

          <div>
            <div className={styles.poolLabel}>Everyone else&rsquo;s words</div>
            <div className={styles.wordsList}>
              {others.every((p) => p.words.length === 0) ? (
                <span className={styles.wordsEmpty}>No words yet</span>
              ) : (
                others.flatMap((p) =>
                  p.words.map((w) => (
                    <span key={`${p.id}-${w}`} className={styles.wordTag}>
                      <span
                        className={styles.wordTagDot}
                        style={{ background: colors.get(p.id) }}
                      />
                      {w}
                    </span>
                  )),
                )
              )}
            </div>
          </div>

          <div>
            <div className={styles.poolLabel}>Your words</div>
            <div className={styles.wordsList}>
              {!me || me.words.length === 0 ? (
                <span className={styles.wordsEmpty}>No words yet</span>
              ) : (
                me.words.map((w) => (
                  <span key={w} className={styles.wordTag}>
                    <span
                      className={styles.wordTagDot}
                      style={{ background: colors.get(playerId) }}
                    />
                    {w}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div role="status" className={styles.message}>
          {message}
        </div>
      )}

      <div className={styles.wordFormDock}>
        <form className={styles.wordForm} onSubmit={submitWord}>
          <div className={styles.wordFormInput}>
            <Input
              value={wordValue}
              onChange={(e) => setWordValue(e.target.value)}
              placeholder="Type a word…"
              size="lg"
            />
          </div>
          <Button type="submit" size="lg">
            Play word
          </Button>
        </form>
      </div>
    </div>
  );
}
