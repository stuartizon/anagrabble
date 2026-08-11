import type { ReactNode } from "react";
import { vi } from "vitest";

// Shared "signed out" stand-in for ../auth, used by page tests that render
// Header (which always renders AccountStatus, see Header.tsx) but aren't
// themselves testing auth state. LoginPage.test.tsx mocks ../auth directly
// instead, since it exercises the sign-in/sign-up flows those hooks drive.
export function mockSignedOutClerk() {
  return {
    Show: ({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) =>
      when === "signed-out" ? <>{children}</> : null,
    useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
    useClerk: () => ({ signOut: vi.fn() }),
    useAuth: () => ({
      isLoaded: true,
      isSignedIn: false,
      userId: null,
      getToken: vi.fn().mockResolvedValue(null),
    }),
  };
}

export interface MockClerkIdentity {
  id: string;
  firstName?: string | null;
  email?: string;
}

let signedInAs: MockClerkIdentity = {
  id: "user_test123",
  firstName: "Testy",
  email: "test@example.com",
};

// Lets a test change who's "signed in" between renders — the functions
// below read this mutable value on every call, so calling this before
// render() (e.g. inside a per-test renderAsPlayer helper) is enough,
// even though the vi.mock("../auth", () => mockSignedInClerk())
// factory itself only runs once per file.
export function setMockClerkIdentity(overrides: Partial<MockClerkIdentity>) {
  signedInAs = { ...signedInAs, ...overrides };
}

// Shared "signed in" stand-in for ../auth — used by pages that are
// gated on sign-in (RequireAuth) and derive the player id/name straight
// from useAuth()/useUser() rather than any client-side stub.
export function mockSignedInClerk() {
  return {
    Show: ({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) =>
      when === "signed-in" ? <>{children}</> : null,
    useUser: () => ({
      isLoaded: true,
      isSignedIn: true,
      user: {
        firstName: signedInAs.firstName ?? null,
        primaryEmailAddress: signedInAs.email ? { emailAddress: signedInAs.email } : null,
      },
    }),
    useClerk: () => ({ signOut: vi.fn() }),
    useAuth: () => ({
      isLoaded: true,
      isSignedIn: true,
      userId: signedInAs.id,
      getToken: vi.fn().mockResolvedValue("test-token"),
    }),
  };
}
