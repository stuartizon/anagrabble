import { X } from "lucide-react";
import { RulesContent } from "./RulesContent";
import styles from "./RulesModal.module.css";

// Matches design-system/New Game.dc.html, Join Game.dc.html, and
// Lobby.dc.html's rulesModalOverlay/rulesModalPanel: a dimmed, centered
// dialog on wider screens, a full-screen takeover on narrow ones (a CSS
// media query here rather than the design's JS isMobile check). Reuses
// RulesContent so this never drifts from the standalone /rules page's copy.
// Always opened via RulesLink, which is also what normalizes the
// inconsistent link copy/alignment the design has across those three pages
// — see RulesLink's own comment.
export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span id="rules-modal-title" className={styles.title}>
            Rules
          </span>
          <button type="button" className={styles.closeButton} aria-label="Close" onClick={onClose}>
            <X size={20} color="var(--text-muted)" />
          </button>
        </div>
        <div className={styles.body}>
          <RulesContent />
        </div>
      </div>
    </div>
  );
}
