export function makeCommandId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
