import { verifyToken } from "@clerk/backend";

export interface AuthResult {
  userId: string;
}

/**
 * Verifies a Clerk session token sent by a connecting client. Never throws —
 * an unverifiable token (missing, expired, forged, or a JWKS network
 * failure) just means "not signed in", not a server error, since gameplay
 * doesn't require a session yet (see CLAUDE.md "Still open").
 */
export async function verifySessionToken(
  token: string,
  secretKey: string,
): Promise<AuthResult | null> {
  try {
    const payload = await verifyToken(token, { secretKey });
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

/**
 * Local-dev/testing counterpart to verifySessionToken, used when
 * AUTH_MODE=mock (see docs/decisions.md "Local dev auth: mock provider,
 * not a Clerk sandbox"). No signature check, no network call — trusts the
 * token string as the user id directly, matching what apps/web's mockAuth
 * sends as a "token" (its mock `useAuth().getToken()` just returns the
 * mock session's id). Only ever reachable when a developer explicitly sets
 * AUTH_MODE=mock locally — never set in Railway, mirroring how
 * VITE_AUTH_MODE=mock is never set in Vercel.
 */
export function verifyMockSessionToken(token: string): AuthResult | null {
  return token ? { userId: token } : null;
}

/**
 * The id a command's actor is trusted to be — always the verified Clerk
 * session id, never a client-claimed one. Returns null when this connection
 * has no verified identity (missing/invalid/expired token), meaning the
 * caller must reject the command rather than fall back to trusting the
 * client's own claim.
 */
export function resolveActingPlayerId(meta: { clerkUserId?: string }): string | null {
  return meta.clerkUserId ?? null;
}
