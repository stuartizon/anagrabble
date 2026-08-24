// Shared by useTurnTimer and useEndGameTimer — both are the same
// client-triggered, server-verified countdown pattern (CLAUDE.md "Turn
// timer enforcement"), just gated on a different deadline field.
export function remainingSeconds(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}
