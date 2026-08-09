import type { PlayerState } from "@anagrabble/protocol";

// Client-side player colors. See docs/redis-schema.md "Player color" —
// this used to be server-assigned by join order and persisted in Redis;
// it's now computed per-viewer from data the client already has, so "you"
// always render in the app's accent color and nobody's color needs
// storage, join-order tracking, or coordination with the server.

export const ACCENT_COLOR = "var(--accent)";
export const OTHER_COLORS = [
  "var(--player-2)",
  "var(--player-3)",
  "var(--player-4)",
  "var(--player-5)",
  "var(--player-6)",
  "var(--player-7)",
  "var(--player-8)",
];

/** Maps every player to a display color. The viewer always sees themselves
 * in `ACCENT_COLOR`; everyone else is ranked by `playerId` (ascending) and
 * assigned the palette in that order, starting from `--player-2` — so a
 * 2-player game always gets the most-contrasting pairing, not whatever a
 * hash happened to land on. Guarantees every player present has a distinct
 * color up to a full 8-player roster (the palette's capacity — see
 * docs/redis-schema.md "Player color").
 *
 * The trade-off, accepted deliberately: this depends on who else is
 * currently in `players`, so a roster change can shift an existing other
 * player's color (unlike a pure per-id hash, which never would). Not
 * observable today — the roster is frozen for the whole game once it
 * starts — and worth revisiting only once players can join/leave mid-game. */
export function assignPlayerColors(players: PlayerState[], selfId: string): Map<string, string> {
  const colors = new Map<string, string>([[selfId, ACCENT_COLOR]]);

  const others = players
    .filter((p) => p.id !== selfId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  others.forEach((player, index) => {
    colors.set(player.id, OTHER_COLORS[index % OTHER_COLORS.length]);
  });

  return colors;
}
