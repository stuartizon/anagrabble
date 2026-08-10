import type { ReactNode } from "react";
import { vi } from "vitest";

// Shared "signed out" stand-in for @clerk/react, used by page tests that
// render Header (which always renders AccountStatus, see Header.tsx) but
// aren't themselves testing auth state. LoginPage.test.tsx mocks
// @clerk/react and @clerk/react/legacy directly instead, since it exercises
// the sign-in/sign-up flows those hooks drive.
export function mockSignedOutClerk() {
  return {
    Show: ({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) =>
      when === "signed-out" ? <>{children}</> : null,
    useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
    useClerk: () => ({ signOut: vi.fn() }),
    useAuth: () => ({ isLoaded: true, isSignedIn: false, userId: null }),
  };
}
