import { Check, Copy } from "lucide-react";
import { useCopyLink } from "../useCopyLink";
import styles from "./InviteLinkRow.module.css";

// The compact treatment design-system/In Game.dc.html uses for its Invite
// section — identical in the desktop sidebar and the mobile menu's Players
// panel (gap:6px, padding:8px 10px, text-xs, 16px icon). LobbyPage's own
// invite row is a deliberately wider, distinct style for its bigger card and
// stays inline there rather than sharing this component.
interface InviteLinkRowProps {
  link: string;
}

export function InviteLinkRow({ link }: InviteLinkRowProps) {
  const { copied, copyLink } = useCopyLink(link);
  return (
    <div className={styles.row}>
      <span className={styles.linkText}>{link}</span>
      <button className={styles.copyButton} onClick={copyLink} aria-label="Copy link">
        {copied ? (
          <Check size={16} color="var(--text-muted)" />
        ) : (
          <Copy size={16} color="var(--text-muted)" />
        )}
      </button>
    </div>
  );
}
