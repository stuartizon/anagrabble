import {
  getPlayerSettings,
  upsertPlayerSettings,
  type Database,
  type Kysely,
  type PlayerSettings,
} from "@anagrabble/postgres";
import type { PlayerSettingsResponse } from "@anagrabble/protocol";
import { verifyMockSessionToken, verifySessionToken } from "./auth.js";
import { reportError } from "./observability.js";

// The only language supported today — a literal tuple, not an
// enum-with-one-member accident. Extending this later (adding a value) is
// additive under packages/protocol/src/rest.ts's expand/contract rules.
const ALLOWED_LANGUAGES = ["English"] as const;

export interface GetSettingsRequestResult {
  status: 200 | 401 | 500;
  body: PlayerSettingsResponse | { error: string };
}

export interface SaveSettingsRequestResult {
  status: 200 | 400 | 401 | 500;
  body: PlayerSettingsResponse | { error: string };
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

/** GET /settings. Framework-agnostic, same shape as stats.ts's
 * handleStatsRequest — see that file's comment for why. */
export async function handleGetSettingsRequest(
  db: Kysely<Database>,
  clerkSecretKey: string,
  authorizationHeader: string | undefined,
  authMode?: string,
): Promise<GetSettingsRequestResult> {
  const auth = await authenticate(clerkSecretKey, authorizationHeader, authMode);
  if (!auth) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  try {
    const settings = await getPlayerSettings(db, auth.userId);
    return { status: 200, body: settings };
  } catch (err) {
    reportError(err, { tags: { op: "http.getSettings", playerId: auth.userId } });
    return { status: 500, body: { error: "Internal error" } };
  }
}

function parseSettingsBody(body: unknown): PlayerSettings | null {
  if (typeof body !== "object" || body === null) return null;
  const { language, soundEnabled, hapticsEnabled } = body as Record<string, unknown>;
  if (!ALLOWED_LANGUAGES.includes(language as (typeof ALLOWED_LANGUAGES)[number])) return null;
  if (typeof soundEnabled !== "boolean") return null;
  if (typeof hapticsEnabled !== "boolean") return null;
  return { language: language as string, soundEnabled, hapticsEnabled };
}

/** PUT /settings. `body` is untyped (`unknown`) since it comes straight
 * from Fastify's JSON body parsing — validated here before touching the
 * DB, same "letters checked before dictionary"-style principle of never
 * trusting client-shaped input (CLAUDE.md), just for HTTP instead of the WS
 * commands that principle was originally written about. */
export async function handleSaveSettingsRequest(
  db: Kysely<Database>,
  clerkSecretKey: string,
  authorizationHeader: string | undefined,
  body: unknown,
  authMode?: string,
): Promise<SaveSettingsRequestResult> {
  const auth = await authenticate(clerkSecretKey, authorizationHeader, authMode);
  if (!auth) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const settings = parseSettingsBody(body);
  if (!settings) {
    return { status: 400, body: { error: "Invalid settings" } };
  }

  try {
    await upsertPlayerSettings(db, auth.userId, settings);
    return { status: 200, body: settings };
  } catch (err) {
    reportError(err, { tags: { op: "http.saveSettings", playerId: auth.userId } });
    return { status: 500, body: { error: "Internal error" } };
  }
}
