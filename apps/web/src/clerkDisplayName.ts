import type { useUser } from "@clerk/react";

type ClerkUser = NonNullable<ReturnType<typeof useUser>["user"]>;

// firstName isn't required at the Clerk config level (see docs/decisions.md
// "Player identity: Clerk id, no anonymous play") — our own sign-up form
// always sends one, but nothing stops an account existing without it (e.g.
// one created outside that form), so the email fallback is permanent, not
// a transitional safety net.
export function getDisplayName(user: ClerkUser | null | undefined): string {
  return user?.firstName || user?.primaryEmailAddress?.emailAddress || "";
}
