import type { CreateGameRequest, LobbySnapshot } from "@anagrabble/protocol";

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) throw new Error("VITE_API_URL is not set");

/** Thrown with the server's error code (e.g. "Unauthorized") rather than a
 * generic message, so callers can distinguish a real rejection from an
 * unreachable-backend/network failure if they want to. */
export class CreateGameError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function createGame(
  token: string,
  request: CreateGameRequest,
): Promise<LobbySnapshot> {
  const res = await fetch(`${API_URL}/games`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new CreateGameError(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
