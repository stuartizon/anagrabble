import type { PlayerState } from "@anagrabble/protocol";

/** Copy for a not-currently-connected player's badge — LobbyPage.tsx and
 * GameBoard.tsx share this so the two player-list renderings can't drift.
 * Same icon either way, only the label differs (see docs/decisions.md
 * "Player presence: connected/disconnected/left tracking"). `undefined`
 * (an older server mid-rollout that doesn't send `presence` yet) and
 * `"connected"` both render nothing. */
export function presenceLabel(presence: PlayerState["presence"]): string | null {
  if (presence === "disconnected") return "Reconnecting…";
  if (presence === "left") return "Left the game";
  return null;
}
