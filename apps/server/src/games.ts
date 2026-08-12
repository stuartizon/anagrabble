import type { Redis } from "@anagrabble/redis";
import type { CreateGameRequest, LobbySnapshot } from "@anagrabble/protocol";
import { createGame } from "./lobby.js";
import { verifyMockSessionToken, verifySessionToken } from "./auth.js";

export interface CreateGameRequestResult {
  status: 201 | 400 | 401 | 409 | 500;
  body: LobbySnapshot | { error: string };
}

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
  const { commandId, gameId, hostName, config } = body as Record<string, unknown>;
  if (typeof commandId !== "string" || !commandId) return null;
  if (typeof gameId !== "string" || !gameId) return null;
  if (typeof hostName !== "string" || !hostName) return null;
  if (typeof config !== "object" || config === null) return null;
  const { turnTimerSec, minWordLength, language } = config as Record<string, unknown>;
  if (typeof turnTimerSec !== "number") return null;
  if (typeof minWordLength !== "number") return null;
  if (typeof language !== "string") return null;
  return { commandId, gameId, hostName, config: { turnTimerSec, minWordLength, language } };
}

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

  try {
    const result = await createGame(redis, { type: "CreateGame", ...request }, auth.userId);
    if ("error" in result) {
      return { status: 409, body: { error: result.error } };
    }
    return { status: 201, body: result.snapshot };
  } catch (err) {
    console.error("[http] error creating game", err);
    return { status: 500, body: { error: "Internal error" } };
  }
}
