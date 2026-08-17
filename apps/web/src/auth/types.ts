import type { ReactNode } from "react";

// The subset of Clerk's surface this app actually uses, hand-rolled so
// clerkAuth.tsx and mockAuth.tsx can both be assigned to it without index.tsx
// ever needing to name a @clerk/react-internal type (see index.tsx).

export type AuthUser = {
  firstName?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
};

export type UseUserResult = { isLoaded: boolean; isSignedIn: boolean; user: AuthUser | null };
export type UseAuthResult = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  getToken: () => Promise<string | null>;
};
export type UseClerkResult = { signOut: () => unknown };

export type SignResult = { status: string; createdSessionId: string | null };

export type UseSignInResult = {
  isLoaded: boolean;
  signIn: {
    create: (params: {
      strategy: string;
      identifier: string;
      password?: string;
    }) => Promise<SignResult>;
    attemptFirstFactor: (params: {
      strategy: string;
      code: string;
      password: string;
    }) => Promise<SignResult>;
    authenticateWithRedirect: (params: {
      strategy: string;
      redirectUrl: string;
      redirectUrlComplete: string;
    }) => Promise<unknown>;
  };
  setActive: (params: { session: string | null }) => Promise<unknown>;
};

export type UseSignUpResult = {
  isLoaded: boolean;
  signUp: {
    create: (params: {
      emailAddress: string;
      password: string;
      firstName?: string;
    }) => Promise<SignResult>;
    prepareEmailAddressVerification: (params: { strategy: string }) => Promise<unknown>;
    attemptEmailAddressVerification: (params: { code: string }) => Promise<SignResult>;
  };
  setActive: (params: { session: string | null }) => Promise<unknown>;
};

export interface AuthModule {
  AuthProvider: (props: { children: ReactNode }) => ReactNode;
  useUser: () => UseUserResult;
  useAuth: () => UseAuthResult;
  useClerk: () => UseClerkResult;
  Show: (props: { when: "signed-in" | "signed-out"; children: ReactNode }) => ReactNode;
  useSignIn: () => UseSignInResult;
  useSignUp: () => UseSignUpResult;
  AuthenticateWithRedirectCallback: (props: {
    signInUrl?: string;
    signUpUrl?: string;
  }) => ReactNode;
}
