import { useState } from "react";

// Shared by every "copy the invite link" affordance (LobbyPage, GameBoard's
// sidebar, and eventually the mobile menu — see design-system/In Game.dc.html,
// where all three show the same copied-for-1600ms feedback).
export function useCopyLink(link: string) {
  const [copied, setCopied] = useState(false);
  const copyLink = () => {
    navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return { copied, copyLink };
}
