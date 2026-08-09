import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import type { Command, LobbySnapshot, UsedWord } from "@anagrabble/protocol";
import { Header } from "../components/Header";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { InviteLinkRow } from "../components/InviteLinkRow";
import { TurnTileButton } from "../components/TurnTileButton";
import { makeCommandId } from "../gameId";
import { assignPlayerColors } from "../playerColors";
import type { GameSocketError, WordPlayNarration } from "../useGameSocket";
import styles from "./GameBoard.module.css";

// Minimal slice of design-system/In Game.dc.html: tile-turning, word
// submission, enough word-list/narration feedback to make a play feel like
// it did something, and a running history panel. The settings modal (game
// config + sound/haptics/language) is a separate, not-yet-built story —
// design-system/In Game.dc.html's mobile menu also bundles a read-only
// "Game settings" section and word-count-per-player column into the same
// panel, both skipped here rather than quietly resolving those un-started
// stories as a side effect of this one.

interface GameBoardProps {
  lobby: LobbySnapshot;
  playerId: string;
  send: (command: Command) => void;
  error: GameSocketError | null;
  wordPlay: WordPlayNarration | null;
  history: WordPlayNarration[];
}

function remainingSeconds(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/** Player-facing copy for a rejected SubmitWord, or `null` to show nothing.
 * `NoDecomposition` and `StaleState` share the same copy, deliberately —
 * from the player's side these are the same outcome ("what I tried isn't
 * currently possible"), just caught by different backend layers depending
 * on timing: `NoDecomposition` when the decomposition search itself
 * (packages/game) already sees nothing buildable (letters genuinely
 * unavailable, or the only option was a bare zero-addition resubmission —
 * those two are merged for the same reason), `StaleState` when the search
 * found something buildable but the atomic Lua re-verification found it
 * had been consumed by a faster play in the gap since (see CLAUDE.md "Word
 * resolution implementation split"). A player has no way to tell those
 * apart and no reason to care which one happened — so neither should the
 * copy. Also deliberately doesn't say "letters" — pool-only insufficient
 * and bare resubmission are different failures underneath, not just "the
 * upturned tiles don't have it".
 *
 * `DerivationBlocked` gets its own distinct copy: unlike the above, this
 * one's genuinely actionable — a decomposition *was* buildable, using real
 * new letters, but it's rejected specifically for being a trivial
 * dictionary derivation (packages/game's `isDerivedFrom`). Only ever
 * reported once letters are confirmed available, same anti-oracle ordering
 * as letters-before-dictionary (see docs/decisions.md "DerivationBlocked as
 * its own rejection reason"). The copy avoids naming a position ("ending",
 * "suffix") since the rule itself isn't positional — the dictionary data
 * only happens to record suffix-style derivations today, not prefixes (see
 * docs/decisions.md "Dictionary source and format" for that known gap).
 *
 * Note there's no "word already claimed" case at all — duplicate claims of
 * the identical word are allowed, as long as the letters are genuinely
 * available each time (see docs/decisions.md "Duplicate word claims are
 * allowed").
 *
 * `NotYourTurn` is suppressed rather than mapped to copy: the only way it
 * can reach this component is the turn-timer effect's own background
 * TurnTile auto-fire losing a race against another client (see that effect
 * below) — the UI never lets a player deliberately click "Turn a tile" when
 * it isn't their turn, so it's never a rejection of something the player
 * actually did. */
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
    case "StaleState":
      return "That's not a legal move right now.";
    case "DerivationBlocked":
      return "You have to change the root.";
    case "NotYourTurn":
      return null;
    default:
      return fallback;
  }
}

function playerName(lobby: LobbySnapshot, playerId: string): string {
  return lobby.players.find((p) => p.id === playerId)?.name ?? "Someone";
}

/** "You stole CAT from Sam -> CAST" (or, for a history row, "Ash stole CAT
 * from Sam -> CAST") — `actorLabel` is "You" for the toast (only ever fires
 * for the player who just played, see the gating on its one call site
 * below) and the actual player name for the history panel, since that list
 * is shared and must read correctly for any viewer. Only called a steal
 * when the used word actually belonged to someone else; extending your own
 * word or a fresh pool play both just say "played". */
function describePlay(
  actorLabel: string,
  lobby: LobbySnapshot,
  play: { playerId: string; word: string; usedWords: UsedWord[] },
): string {
  const stolen = play.usedWords.find((w) => w.ownerId !== play.playerId);
  if (stolen) {
    return `${actorLabel} stole ${stolen.word} from ${playerName(lobby, stolen.ownerId)} → ${play.word}`;
  }
  return `${actorLabel} played ${play.word}`;
}

function narrateOwnPlay(lobby: LobbySnapshot, play: WordPlayNarration): string {
  return describePlay("You", lobby, play);
}

const MESSAGE_DISMISS_MS = 2500;

/** Players/Invite/History — identical content for the desktop sidebar
 * (`<aside>`, always mounted, hidden below 840px by CSS) and the mobile
 * menu overlay (conditionally mounted, only above 840px unreachable).
 * Rendered as its own function component so each call site gets its own
 * element tree/keys rather than one JSX value reused in two places.
 *
 * History is deliberately NOT part of this — design-system/In
 * Game.dc.html's mobileMenuOpen panel only ever has Players/Invite/Game
 * settings/Your settings, no history section, unlike the desktop
 * `<aside>` which has all three of Players/Invite/History. So the desktop
 * sidebar renders this plus its own History block; the mobile overlay
 * renders only this. */
function PlayersAndInviteSections({
  lobby,
  colors,
  shareLink,
}: {
  lobby: LobbySnapshot;
  colors: Map<string, string>;
  shareLink: string;
}) {
  return (
    <>
      <div className={styles.playersSection}>
        <div className={styles.poolLabel}>Players</div>
        {lobby.players.map((p) => (
          <div key={p.id} className={styles.playerRow}>
            <span className={styles.playerDot} style={{ background: colors.get(p.id) }} />
            <span className={styles.playerName} data-testid="sidebar-player-name">
              {p.name}
            </span>
            <span className={styles.playerScore}>{p.score}</span>
          </div>
        ))}
      </div>

      <div>
        <div className={styles.poolLabel}>Invite</div>
        <InviteLinkRow link={shareLink} />
      </div>
    </>
  );
}

function HistorySection({
  lobby,
  colors,
  history,
}: {
  lobby: LobbySnapshot;
  colors: Map<string, string>;
  history: WordPlayNarration[];
}) {
  return (
    <div className={styles.historySection}>
      <div className={styles.poolLabel}>History</div>
      <div className={styles.historyList}>
        {history.length === 0 ? (
          <span className={styles.wordsEmpty}>No words played yet.</span>
        ) : (
          [...history].reverse().map((entry) => (
            <div key={entry.seq} className={styles.historyEntry}>
              <span
                className={styles.historyDot}
                style={{ background: colors.get(entry.playerId) }}
              />
              <span className={styles.historyText}>
                {describePlay(playerName(lobby, entry.playerId), lobby, entry)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function GameBoard({ lobby, playerId, send, error, wordPlay, history }: GameBoardProps) {
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

  // Turning a tile is meant to be a quick side-action mid-typing, not a
  // context switch — a native <button> otherwise steals focus on click
  // (Chrome/Edge; not Safari), forcing a re-click into the word box to
  // keep typing. Word submission clears+refocuses for the same reason.
  const wordInputRef = useRef<HTMLInputElement>(null);

  const turnTile = () => {
    send({ type: "TurnTile", commandId: makeCommandId(), gameId, playerId });
    wordInputRef.current?.focus();
  };

  const shareLink = `${window.location.origin}/${gameId}`;

  const [menuOpen, setMenuOpen] = useState(false);
  const [wordValue, setWordValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Read inside the wordPlay effect via ref rather than as a dependency —
  // lobby gets a new object on every TileTurned/etc. too, and the toast must
  // only (re)trigger when wordPlay itself changes, not on unrelated snapshot
  // updates (that previously reopened a just-dismissed toast on the next
  // tile turn).
  const lobbyRef = useRef(lobby);
  lobbyRef.current = lobby;
  // The input is cleared optimistically on submit (below), so by the time an
  // Error event comes back asynchronously, wordValue itself no longer has
  // what was attempted. Keyed by commandId (round-tripped on ErrorEvent)
  // rather than just remembering "the last one" — a player submitting twice
  // before the first rejection comes back must still get the right word
  // named in the right message, not whichever was typed most recently.
  const pendingWordsRef = useRef(new Map<string, string>());

  useEffect(() => {
    // Only the actor's own play gets a toast — someone else's success is
    // shared/ambient information (the board itself already reflects it),
    // not personal feedback about this screen, so it doesn't belong in the
    // same slot as this player's own errors. See docs/decisions.md "Toasts
    // are personal, not broadcast narration".
    if (!wordPlay || wordPlay.playerId !== playerId) return;
    setMessage(narrateOwnPlay(lobbyRef.current, wordPlay));
    const timer = setTimeout(() => setMessage(null), MESSAGE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [wordPlay, playerId]);

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
    wordInputRef.current?.focus();
  };

  const me = lobby.players.find((p) => p.id === playerId);
  const others = lobby.players.filter((p) => p.id !== playerId);

  return (
    <div className={styles.page}>
      <Header>
        <span className={styles.bankCount}>{lobby.bankCount} tiles left</span>
        <button className={styles.menuButton} aria-label="Menu" onClick={() => setMenuOpen(true)}>
          <Menu size={20} color="var(--text-muted)" />
        </button>
      </Header>

      {menuOpen && (
        <div className={styles.menuOverlay} data-testid="mobile-menu">
          <div className={styles.menuHeader}>
            <span className={styles.menuTitle}>Menu</span>
            <button
              className={styles.menuCloseButton}
              aria-label="Close"
              onClick={() => setMenuOpen(false)}
            >
              <X size={20} color="var(--text-muted)" />
            </button>
          </div>
          <div className={styles.menuBody}>
            <PlayersAndInviteSections lobby={lobby} colors={colors} shareLink={shareLink} />
          </div>
        </div>
      )}

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <PlayersAndInviteSections lobby={lobby} colors={colors} shareLink={shareLink} />
          <HistorySection lobby={lobby} colors={colors} history={history} />
        </aside>

        <div className={styles.main}>
          <div className={styles.scrollArea}>
            <div className={styles.board}>
              <div>
                <div className={styles.poolHeader}>
                  <div className={styles.poolLabel}>Upturned tiles</div>
                  {lobby.bankCount <= 0 ? (
                    <span className={styles.turnHint}>No more tiles.</span>
                  ) : isCurrentPlayer ? (
                    <TurnTileButton
                      secondsLeft={secondsLeft}
                      totalSeconds={lobby.config.turnTimerSec}
                      onClick={turnTile}
                    />
                  ) : (
                    <span className={styles.turnHint}>
                      {currentPlayer?.name ?? "Someone"}&rsquo;s turn
                    </span>
                  )}
                </div>
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

              {others.length > 0 && (
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
              )}

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
                  ref={wordInputRef}
                  value={wordValue}
                  onChange={(e) =>
                    setWordValue(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
                  }
                  placeholder="Type a word…"
                  size="lg"
                  mono
                  autoFocus
                />
              </div>
              <Button type="submit" size="lg">
                Play word
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
