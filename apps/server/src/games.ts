import type { Redis } from "@anagrabble/redis";
import type { CreateGameRequest, LobbySnapshot } from "@anagrabble/protocol";
import { createGame, leaveGame, loadGameState, toLobbySnapshot } from "./lobby.js";
import { verifyMockSessionToken, verifySessionToken } from "./auth.js";

export interface CreateGameRequestResult {
  status: 201 | 400 | 401 | 409 | 500;
  body: LobbySnapshot | { error: string };
}

export type LeaveGameRequestResult =
  | { status: 200; body: LobbySnapshot; playerId: string; removed: boolean }
  | { status: 401 | 404; body: { error: string } };

function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

async function authenticate(
  clerkSecretKey: string,
  authorizationHeader: string | undefined,
  authMode: string | undefined,
) {
  const token = parseBearerToken(authorizationHeader);
  if (!token) return null;
  return authMode === "mock"
    ? verifyMockSessionToken(token)
    : await verifySessionToken(token, clerkSecretKey);
}

function parseCreateGameBody(body: unknown): CreateGameRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { hostName, config } = body as Record<string, unknown>;
  if (typeof hostName !== "string" || !hostName) return null;
  if (typeof config !== "object" || config === null) return null;
  const { turnTimerSec, minWordLength, language } = config as Record<string, unknown>;
  if (typeof turnTimerSec !== "number") return null;
  if (typeof minWordLength !== "number") return null;
  if (typeof language !== "string") return null;
  return { hostName, config: { turnTimerSec, minWordLength, language } };
}

/** Same shape as apps/web's (now-removed) makeGameId() — short,
 * human-shareable invite codes, not security-sensitive (uniqueness matters,
 * secrecy doesn't), so Math.random() is fine. Server-generated now (see
 * docs/decisions.md "CreateGame as a REST endpoint"): standard REST
 * semantics, the server assigns the resource's identity rather than
 * trusting a client-supplied one. */
function makeGameId(): string {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

// 60M+ possible 5-char codes and, realistically, a handful of concurrent
// games — a true collision is vanishingly unlikely. This bound exists so a
// pathological run of bad luck fails loudly (500) instead of looping
// forever, not because 5 is a carefully tuned number.
const MAX_GAME_ID_ATTEMPTS = 5;

/** POST /games. Same framework-agnostic shape as stats.ts/settings.ts —
 * see settings.ts's comment for why. Delegates the actual mutation to
 * lobby.ts's createGame(), the exact function the WS `CreateGame` command
 * handler in index.ts calls too (see docs/decisions.md "CreateGame as a
 * REST endpoint") — this is a thin auth/validation/status-code wrapper
 * around it, not a second implementation. `body` is untyped (`unknown`)
 * since it comes straight from Fastify's JSON body parsing, validated here
 * before touching Redis (CLAUDE.md "never trusting client-shaped input"). */
export async function handleCreateGameRequest(
  redis: Redis,
  clerkSecretKey: string,
  authorizationHeader: string | undefined,
  body: unknown,
  authMode?: string,
): Promise<CreateGameRequestResult> {
  const auth = await authenticate(clerkSecretKey, authorizationHeader, authMode);
  if (!auth) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const request = parseCreateGameBody(body);
  if (!request) {
    return { status: 400, body: { error: "Invalid request" } };
  }

  // Synthesized, not client-supplied — see the CreateGameRequest doc
  // comment (packages/protocol/src/rest.ts) for why a fresh server-
  // generated commandId is behaviorally identical to a real one here:
  // createGame()'s dedup check only ever matters for a legitimate retry of
  // the exact same gameId, which this endpoint's collision loop never does.
  const commandId = crypto.randomUUID();

  try {
    for (let attempt = 0; attempt < MAX_GAME_ID_ATTEMPTS; attempt++) {
      const gameId = makeGameId();
      const result = await createGame(
        redis,
        { type: "CreateGame", ...request, gameId, commandId },
        auth.userId,
      );
      if (!("error" in result)) {
        return { status: 201, body: result.snapshot };
      }
      if (result.error !== "GameIdTaken") {
        return { status: 409, body: { error: result.error } };
      }
      // Collision on a freshly generated id — try again with a new one.
    }
    console.error("[http] exhausted gameId attempts", { attempts: MAX_GAME_ID_ATTEMPTS });
    return { status: 500, body: { error: "Internal error" } };
  } catch (err) {
    console.error("[http] error creating game", err);
    return { status: 500, body: { error: "Internal error" } };
  }
}

/** POST /games/:gameId/leave — see docs/decisions.md "Player presence:
 * connected/disconnected tracking". A deliberate, explicit leave,
 * distinct from a connection dropping: no grace period, since nothing here
 * is inferred. Delegates to lobby.ts's leaveGame() (unchanged by this
 * feature — it's already correctly a no-op once the game has started).
 * `removed: false` on success means leaveGame() no-opped (already started,
 * or this player wasn't actually seated) — the caller (apps/server/src/
 * index.ts) uses that to decide whether a PlayerLeft broadcast is
 * warranted, since a no-op has nothing to announce. */
export async function handleLeaveGameRequest(
  redis: Redis,
  clerkSecretKey: string,
  authorizationHeader: string | undefined,
  gameId: string,
  authMode?: string,
): Promise<LeaveGameRequestResult> {
  const auth = await authenticate(clerkSecretKey, authorizationHeader, authMode);
  if (!auth) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const before = await loadGameState(redis, gameId);
  if (!before) {
    return { status: 404, body: { error: "GameNotFound" } };
  }

  const snapshot = await leaveGame(redis, gameId, auth.userId);
  if (!snapshot) {
    return {
      status: 200,
      body: toLobbySnapshot(gameId, before),
      playerId: auth.userId,
      removed: false,
    };
  }

  return { status: 200, body: snapshot, playerId: auth.userId, removed: true };
}
