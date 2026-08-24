import { Check, Copy } from "lucide-react";
import { useCopyLink } from "../hooks/useCopyLink";
import styles from "./InviteCode.module.css";

// Matches design-system/InviteCode.dc.html — replaces the earlier
// link-text-only treatment (InviteLinkRow, and GamePage's own inline
// variant) with the short human-shareable code (games.ts's makeGameId())
// plus a "Copy link"/"Link copied" text button, workshopped in Claude
// Design. The "Invite code" label is fixed, not parameterized — every
// screen that shows this component wants the same caption.
interface InviteCodeProps {
  code: string;
  shareLink: string;
}

export function InviteCode({ code, shareLink }: InviteCodeProps) {
  const { copied, copyLink } = useCopyLink(shareLink);
  return (
    <div className={styles.container}>
      <div className={styles.label}>Invite code</div>
      <div className={styles.row}>
        <span className={styles.code}>{code.toUpperCase()}</span>
        <button className={styles.copyButton} onClick={copyLink} aria-label="Copy link">
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
