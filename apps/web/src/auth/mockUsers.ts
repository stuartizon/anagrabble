export interface MockUserSeed {
  id: string;
  email: string;
  displayName: string;
}

// Local dev roster for VITE_AUTH_MODE=mock (see docs/decisions.md "Local
// dev auth: mock provider, not a Clerk sandbox"). Lets multiple browser
// contexts/tabs sign in as distinct, recognizable players with one click —
// needed to exercise this app's multiplayer flows (two-plus players in the
// same lobby/game). This is the only way to sign in locally — mockAuth.tsx
// rejects the normal email/password and Google form paths on purpose, so
// there's no ambiguity about which identity a given browser context is. To
// add a dev user, add an entry here — nothing else to wire up.
export const MOCK_USERS: MockUserSeed[] = [
  { id: "mock-alice", email: "alice@dev.local", displayName: "Alice" },
  { id: "mock-bob", email: "bob@dev.local", displayName: "Bob" },
  { id: "mock-charlie", email: "charlie@dev.local", displayName: "Charlie" },
  { id: "mock-diana", email: "diana@dev.local", displayName: "Diana" },
];
