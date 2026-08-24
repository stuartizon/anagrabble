import type { PlayerState } from "@anagrabble/protocol";

/** Copy for a not-currently-connected player's badge — GamePage.tsx and
 * GameBoard.tsx share this so the two player-list renderings can't drift.
 * "Disconnected", not "Reconnecting…": the latter implies an active,
 * likely-to-succeed-soon process, which isn't knowable — this could just
 * as easily be a player who's gone for good. `undefined` (an older server
 * mid-rollout that doesn't send `presence` yet) and `"connected"` both
 * render nothing. */
export function presenceLabel(presence: PlayerState["presence"]): string | null {
  if (presence === "disconnected") return "Disconnected";
  return null;
}
