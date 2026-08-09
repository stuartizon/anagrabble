// Client-generated short game code — same pattern as commandId (client
// generates, server just checks for a collision). Matches the shape used by
// the design prototype's invite links.
export function makeGameId(): string {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

export function makeCommandId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
