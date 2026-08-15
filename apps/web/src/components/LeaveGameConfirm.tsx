import { Button } from "./Button";
import styles from "./LeaveGameConfirm.module.css";

// Matches design-system/In Game.dc.html's leaveConfirmOpen dialog — a
// small centered dialog at every width, unlike RulesModal/the mobile menu
// which go full-screen below the 840px breakpoint; the design source has
// no isMobile branch for this one. Opened from three places in GameBoard:
// the desktop header's "Leave game" button, the mobile menu's own "Leave
// game" button, and clicking the wordmark (via Header's onWordmarkClick).
interface LeaveGameConfirmProps {
  gameCode: string;
  leaving: boolean;
  error: string | null;
  onKeepPlaying: () => void;
  onLeave: () => void;
}

export function LeaveGameConfirm({
  gameCode,
  leaving,
  error,
  onKeepPlaying,
  onLeave,
}: LeaveGameConfirmProps) {
  return (
    <div className={styles.overlay} onClick={onKeepPlaying}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span id="leave-confirm-title" className={styles.title}>
          Leave this game?
        </span>
        <span className={styles.body}>
          Your words stay on the board and the others keep playing. You can rejoin with the code{" "}
          {gameCode} while the game is running.
        </span>
        {error && <span className={styles.error}>{error}</span>}
        <div className={styles.actions}>
          <Button variant="secondary" size="lg" onClick={onKeepPlaying} fullWidth>
            Keep playing
          </Button>
          <Button variant="danger" size="lg" disabled={leaving} onClick={onLeave} fullWidth>
            {leaving ? "Leaving…" : "Leave game"}
          </Button>
        </div>
      </div>
    </div>
  );
}
