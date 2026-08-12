// Barrel — re-exports both halves of this package's shared types:
// ws.ts (the WebSocket Command/Event wire protocol, versioned via
// PROTOCOL_VERSION under CLAUDE.md's expand/contract rules) and rest.ts
// (plain REST response DTOs, not covered by that handshake — see rest.ts's
// own comment for why). Neither is primary; import from here rather than
// reaching into either file directly.

export * from "./ws.js";
export * from "./rest.js";
