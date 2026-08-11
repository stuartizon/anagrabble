import { authModule as clerkAuthModule } from "./clerkAuth";
import { authModule as mockAuthModule, signInAsMockUser } from "./mockAuth";
import { MOCK_USERS, type MockUserSeed } from "./mockUsers";

// Every other module imports auth hooks from here, never directly from
// @clerk/react — that's what lets local dev run against mockAuth.tsx with
// no network calls at all, switched on by VITE_AUTH_MODE=mock in
// apps/web/.env (see docs/decisions.md "Local dev auth: mock provider, not
// a Clerk sandbox"). Deployed environments leave VITE_AUTH_MODE unset and
// get the real Clerk provider, unchanged from before this module existed.
// Both sides are typed against the hand-rolled AuthModule interface
// (types.ts) rather than Clerk's own types, which TS can't otherwise name
// portably once unioned with mockAuth's plain object.
const isMock = import.meta.env.VITE_AUTH_MODE === "mock";
const impl = isMock ? mockAuthModule : clerkAuthModule;

export const AuthProvider = impl.AuthProvider;
export const useUser = impl.useUser;
export const useAuth = impl.useAuth;
export const useClerk = impl.useClerk;
export const Show = impl.Show;
export const useSignIn = impl.useSignIn;
export const useSignUp = impl.useSignUp;
export const AuthenticateWithRedirectCallback = impl.AuthenticateWithRedirectCallback;

// Only meaningful in mock mode: LoginPage renders a "sign in as…" quick
// pick from this list when non-empty, letting a developer (or an
// automated browser session) become a distinct named player in one click
// instead of filling out the sign-up form — see mockUsers.ts. Real Clerk
// has no equivalent, so this stays outside AuthModule rather than forcing
// clerkAuth.tsx to fake it; both are empty/null in real-Clerk mode so
// LoginPage's check is a plain length/null guard either way.
export const mockUsers: MockUserSeed[] = isMock ? MOCK_USERS : [];
export const quickSignIn: ((user: MockUserSeed) => void) | null = isMock ? signInAsMockUser : null;
