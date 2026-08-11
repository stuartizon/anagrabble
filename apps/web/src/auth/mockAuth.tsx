import { useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { AuthModule, SignResult } from "./types";
import type { MockUserSeed } from "./mockUsers";

// Stands in for @clerk/react during local dev (VITE_AUTH_MODE=mock) so the
// app runs with no network calls at all — see docs/decisions.md "Local dev
// auth: mock provider, not a Clerk sandbox". Session state is a
// module-level singleton (mirroring how Clerk's own store works) persisted
// to localStorage, so a page refresh keeps you signed in. getToken() just
// returns the mock user's id — apps/server's matching AUTH_MODE=mock trusts
// that id directly rather than verifying a real Clerk JWT.
//
// The email/password form and "Continue with Google" both reject on
// purpose (see mockFormDisabled below) — signInAsMockUser (LoginPage's
// "sign in as…" roster) is the only way to sign in here, so a given
// browser context's identity is always exactly one of the known seeded
// personas, never an arbitrary typed-in one.

const STORAGE_KEY = "anagrabble:mockAuth";

type MockUser = MockUserSeed;

function readSession(): MockUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MockUser) : null;
  } catch {
    return null;
  }
}

let session: MockUser | null = readSession();
const listeners = new Set<() => void>();

function setSession(next: MockUser | null) {
  session = next;
  if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  else localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useSession(): MockUser | null {
  return useSyncExternalStore(subscribe, () => session);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useUser() {
  const current = useSession();
  return {
    isLoaded: true,
    isSignedIn: current !== null,
    user: current
      ? { firstName: current.displayName, primaryEmailAddress: { emailAddress: current.email } }
      : null,
  };
}

export function useAuth() {
  const current = useSession();
  return {
    isLoaded: true,
    isSignedIn: current !== null,
    userId: current?.id ?? null,
    getToken: async () => current?.id ?? null,
  };
}

export function useClerk() {
  return { signOut: () => setSession(null) };
}

export function Show({
  when,
  children,
}: {
  when: "signed-in" | "signed-out";
  children: ReactNode;
}) {
  const signedIn = useSession() !== null;
  return (when === "signed-in") === signedIn ? <>{children}</> : null;
}

// Thrown in Clerk's own error shape ({ errors: [{ message }] }) so
// LoginPage's existing errorMessage() surfaces it without any mock-specific
// handling on the caller's side. Two variants since the reset-password code
// screen doesn't have the persona buttons on it — the login page does.
function mockFormDisabled(): never {
  throw {
    errors: [{ message: "Local dev sign-in only works via the personas above — pick one." }],
  };
}

function mockFormDisabledFromLogin(): never {
  throw {
    errors: [
      {
        message:
          "Local dev sign-in only works via the personas on the login page — go back and pick one.",
      },
    ],
  };
}

export function useSignIn() {
  return {
    isLoaded: true,
    signIn: {
      create: async ({ strategy }: { strategy: string }): Promise<SignResult> => {
        // The "send reset code" step is harmless to let through — no code
        // is actually sent, it just advances to the next screen. Only
        // attemptFirstFactor below (which would actually sign someone in)
        // stays disabled.
        if (strategy === "reset_password_email_code") {
          return { status: "needs_first_factor", createdSessionId: null };
        }
        return mockFormDisabled();
      },
      attemptFirstFactor: async (): Promise<SignResult> => mockFormDisabledFromLogin(),
      authenticateWithRedirect: async () => mockFormDisabled(),
    },
    setActive: async () => {},
  };
}

export function useSignUp() {
  return {
    isLoaded: true,
    signUp: {
      create: async (): Promise<SignResult> => mockFormDisabled(),
      prepareEmailAddressVerification: async () => mockFormDisabled(),
      attemptEmailAddressVerification: async (): Promise<SignResult> => mockFormDisabled(),
    },
    setActive: async () => {},
  };
}

// Real Clerk redirects here mid-OAuth-handshake; the mock never reaches it
// since authenticateWithRedirect above rejects before any redirect happens.
// Kept only so SsoCallbackPage still renders something sane if visited
// directly.
export function AuthenticateWithRedirectCallback() {
  useEffect(() => {
    window.location.assign("/");
  }, []);
  return null;
}

// Bypasses the signIn/signUp form flow entirely — LoginPage's "sign in
// as…" quick pick calls this directly to switch identity in one click.
export function signInAsMockUser(user: MockUserSeed) {
  setSession(user);
}

export const authModule: AuthModule = {
  AuthProvider,
  useUser,
  useAuth,
  useClerk,
  Show,
  useSignIn,
  useSignUp,
  AuthenticateWithRedirectCallback,
};
