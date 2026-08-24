import type { GameSnapshot } from "@anagrabble/protocol";
import { API_URL } from "../env";

/** Thrown with the server's error code (e.g. "GameNotFound") rather than a
 * generic message, so callers can distinguish a real rejection from an
 * unreachable-backend/network failure if they want to — same shape as
 * fetchCreateGame.ts's CreateGameError. */
export class LeaveGameError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** POST /games/:gameId/leave — a deliberate, explicit pre-start leave, not
 * inferred from a connection dropping. See docs/decisions.md "Player
 * presence: connected/disconnected tracking". */
export async function leaveGame(token: string, gameId: string): Promise<GameSnapshot> {
  const res = await fetch(`${API_URL}/games/${gameId}/leave`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new LeaveGameError(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
