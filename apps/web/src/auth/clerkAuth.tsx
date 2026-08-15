import type { ReactNode } from "react";
import {
  ClerkProvider,
  Show,
  useClerk,
  useUser,
  useAuth,
  AuthenticateWithRedirectCallback,
} from "@clerk/react";
import { useSignIn, useSignUp } from "@clerk/react/legacy";
import type { AuthModule } from "./types";
import { requireClerkPublishableKey } from "../env";

function AuthProvider({ children }: { children: ReactNode }) {
  return <ClerkProvider publishableKey={requireClerkPublishableKey()}>{children}</ClerkProvider>;
}

// Cast, not a structural check: Clerk's real hooks return richer objects
// (more fields, overloaded params) than AuthModule declares. This app only
// ever touches the fields AuthModule names, and TS can't otherwise emit a
// portable type for a union with mockAuth's plain object — see types.ts.
export const authModule = {
  AuthProvider,
  Show,
  useClerk,
  useUser,
  useAuth,
  useSignIn,
  useSignUp,
  AuthenticateWithRedirectCallback,
} as unknown as AuthModule;
