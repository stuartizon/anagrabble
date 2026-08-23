import { LogOut, Menu } from "lucide-react";
import type { Command, LobbySnapshot } from "@anagrabble/protocol";
import { Header } from "../../../components/Header";
import { LeaveGameConfirm } from "../../../components/LeaveGameConfirm";
import { makeCommandId } from "../../../gameId";
import { assignPlayerColors } from "../../../playerColors";
import type {
  GameSocketError,
  HistoryEntry,
  SocketStatus,
  WordPlayNarration,
} from "../../../useGameSocket";
import type { SoundName } from "../../../useGameSounds";
import { PlayersAndInviteSections } from "./PlayersAndInviteSections";
import { HistorySection } from "./HistorySection";
import { BoardSection } from "./BoardSection";
import { WordFormDock } from "./WordFormDock";
import { MobileMenu } from "./MobileMenu";
import { useTurnTimer } from "./useTurnTimer";
import { useEndGameTimer } from "./useEndGameTimer";
import { useLeaveGuard } from "./useLeaveGuard";
import { useWordFeedback } from "./useWordFeedback";
import { useWordForm } from "./useWordForm";
import styles from "./GameBoard.module.css";

// Minimal slice of design-system/In Game.dc.html: tile-turning, word
// submission, enough word-list/narration feedback to make a play feel like
// it did something, and a running history panel. The settings modal (game
// config + sound/haptics/language) is a separate, not-yet-built story —
// design-system/In Game.dc.html's mobile menu also bundles a read-only
// "Game settings" section into the same panel, skipped here rather than
// quietly resolving that un-started story as a side effect of this one.
// The mobile menu's per-player word-count column is skipped too, but for a
// different reason: deliberately dropped, not deferred — see
// docs/decisions.md "Word-count badge dropped, not deferred".
//
// Split into this directory per anagrabble#37's approach notes: each
// concern below (timers, leave-guard navigation traps, word-form
// submission, toast/sound feedback) is its own hook, and each renderable
// section (sidebar, board, mobile menu, word form) is its own component —
// this file just wires them together.

interface GameBoardProps {
  lobby: LobbySnapshot;
  playerId: string;
  send: (command: Command) => void;
  error: GameSocketError | null;
  wordPlay: WordPlayNarration | null;
  playSound: (name: SoundName) => void;
  history: HistoryEntry[];
  status: SocketStatus;
  onLeaveGame: () => void;
  leaving: boolean;
  leaveError: string | null;
}

export function GameBoard({
  lobby,
  playerId,
  send,
  error,
  wordPlay,
  playSound,
  history,
  status,
  onLeaveGame,
  leaving,
  leaveError,
}: GameBoardProps) {
  const colors = assignPlayerColors(lobby.players, playerId);
  const currentPlayer = lobby.players.find((p) => p.id === lobby.turnPlayerId);
  const isCurrentPlayer = currentPlayer?.id === playerId;
  const gameId = lobby.gameId;

  const currentPlayerUnreachable =
    currentPlayer?.presence != null && currentPlayer.presence !== "connected";
  const secondsLeft = useTurnTimer({
    turnDeadline: lobby.turnDeadline,
    gameId,
    bankCount: lobby.bankCount,
    currentPlayerUnreachable,
    send,
  });

  // Gated on status === "playing" so the idle countdown stops firing once
  // the game has actually ended.
  const endGameDeadline = lobby.status === "playing" ? lobby.endGameDeadline : null;
  const endGameSecondsLeft = useEndGameTimer({ endGameDeadline, gameId, send });

  const { message: feedbackMessage, registerAttempt } = useWordFeedback({
    lobby,
    playerId,
    wordPlay,
    error,
    playSound,
  });
  const { wordValue, setWordValue, inputRef, submitWord, refocusInput } = useWordForm({
    gameId,
    send,
    registerAttempt,
  });

  const turnTile = () => {
    send({ type: "TurnTile", commandId: makeCommandId(), gameId });
    refocusInput();
  };

  const shareLink = `${window.location.origin}/${gameId}`;

  const { menuOpen, setMenuOpen, leaveConfirmOpen, openLeaveConfirm, closeLeaveConfirm } =
    useLeaveGuard();

  // Takes priority over the word-feedback toast in the same slot rather
  // than appending a second one: while the socket's down, a lingering "you
  // stole CAT" toast is stale/misleading anyway, and nothing can be
  // submitted regardless (see useGameSocket's RECONNECT_DELAYS_MS). Unlike
  // that toast, this isn't on a dismiss timer — it tracks `status` directly,
  // so it stays up for the whole outage, however many backoff attempts that
  // takes.
  const displayedMessage = status === "reconnecting" ? "Reconnecting…" : feedbackMessage;

  return (
    <div className={styles.page}>
      <Header
        onWordmarkClick={(e) => {
          e.preventDefault();
          openLeaveConfirm();
        }}
      >
        <span className={styles.bankCount}>{lobby.bankCount} tiles left</span>
        <button className={styles.menuButton} aria-label="Menu" onClick={() => setMenuOpen(true)}>
          <Menu size={20} color="var(--text-muted)" />
        </button>
        <button className={styles.leaveButton} onClick={openLeaveConfirm}>
          <LogOut size={16} />
          Leave game
        </button>
      </Header>

      {menuOpen && (
        <MobileMenu
          lobby={lobby}
          colors={colors}
          shareLink={shareLink}
          onClose={() => setMenuOpen(false)}
          onOpenLeaveConfirm={openLeaveConfirm}
        />
      )}

      {leaveConfirmOpen && (
        <LeaveGameConfirm
          gameCode={lobby.gameId}
          leaving={leaving}
          error={leaveError}
          onKeepPlaying={closeLeaveConfirm}
          onLeave={onLeaveGame}
        />
      )}

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <PlayersAndInviteSections lobby={lobby} colors={colors} shareLink={shareLink} />
          <HistorySection lobby={lobby} colors={colors} history={history} />
        </aside>

        <div className={styles.main}>
          <div className={styles.scrollArea}>
            <BoardSection
              lobby={lobby}
              colors={colors}
              playerId={playerId}
              currentPlayer={currentPlayer}
              isCurrentPlayer={isCurrentPlayer}
              secondsLeft={secondsLeft}
              endGameDeadline={endGameDeadline}
              endGameSecondsLeft={endGameSecondsLeft}
              onTurnTile={turnTile}
            />
          </div>

          {displayedMessage && (
            <div className={styles.messageAnchor}>
              <div className={styles.message}>
                <span role="status" className={styles.messagePill}>
                  {displayedMessage}
                </span>
              </div>
            </div>
          )}

          <WordFormDock
            value={wordValue}
            onChange={setWordValue}
            onSubmit={submitWord}
            inputRef={inputRef}
          />
        </div>
      </div>
    </div>
  );
}
