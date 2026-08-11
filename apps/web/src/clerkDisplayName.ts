import type { AuthUser } from "./auth/types";

// firstName isn't required at the Clerk config level (see docs/decisions.md
// "Player identity: Clerk id, no anonymous play") — our own sign-up form
// always sends one, but nothing stops an account existing without it (e.g.
// one created outside that form), so the email fallback is permanent, not
// a transitional safety net.
export function getDisplayName(user: AuthUser | null | undefined): string {
  return user?.firstName || user?.primaryEmailAddress?.emailAddress || "";
}
