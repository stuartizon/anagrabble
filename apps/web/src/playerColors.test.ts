// TDD for client-side player colors. See docs/redis-schema.md "Player
// color" for the rationale: this used to be server-assigned-at-join-order
// and persisted in Redis; it's now a pure function computed per-viewer, so
// "you" always render in the accent color and nobody's color depends on
// storage, join order, or coordination with the server.

import type { PlayerState } from "@anagrabble/protocol";
import { describe, expect, it } from "vitest";
import { ACCENT_COLOR, OTHER_COLORS, assignPlayerColors } from "./playerColors.js";

function player(id: string): PlayerState {
  return { id, name: id, words: [], score: 0 };
}

describe("assignPlayerColors", () => {
  it("always gives the viewer themselves the accent color", () => {
    const colors = assignPlayerColors([player("me"), player("a"), player("b")], "me");
    expect(colors.get("me")).toBe(ACCENT_COLOR);
  });

  it("gives a single other player the first (most-contrasting) palette color", () => {
    // The common case: a 2-player game should always pair the accent with
    // --player-2, not risk landing on a low-contrast color further down
    // the palette (see the conversation this came from — hashing could put
    // a lone opponent on --player-7/8, which reads too close to the accent
    // green).
    const colors = assignPlayerColors([player("me"), player("a")], "me");
    expect(colors.get("a")).toBe(OTHER_COLORS[0]);
  });

  it("fills the palette from its most-contrasting end, in ascending playerId order", () => {
    const colors = assignPlayerColors([player("me"), player("c"), player("a"), player("b")], "me");
    expect(colors.get("a")).toBe(OTHER_COLORS[0]);
    expect(colors.get("b")).toBe(OTHER_COLORS[1]);
    expect(colors.get("c")).toBe(OTHER_COLORS[2]);
  });

  it("never gives two different players the same color, up to a full 8-player roster", () => {
    const players = "abcdefgh".split("").map(player);
    const colors = assignPlayerColors(players, "a");

    const values = [...colors.values()];
    expect(new Set(values).size).toBe(8);
  });

  it("is deterministic for the same roster and viewer", () => {
    const players = [player("me"), player("a"), player("b")];
    const first = assignPlayerColors(players, "me");
    const second = assignPlayerColors(players, "me");
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it("doesn't depend on the input array's order, only on who's present", () => {
    const players = [player("me"), player("a"), player("b"), player("c")];
    const shuffled = [player("b"), player("me"), player("c"), player("a")];

    const colors = assignPlayerColors(players, "me");
    const colorsShuffled = assignPlayerColors(shuffled, "me");

    expect([...colorsShuffled.entries()]).toEqual([...colors.entries()]);
  });

  it("wraps around (reusing colors) once there are more than 7 other players", () => {
    // Accepted capacity limit — see docs/redis-schema.md "Player color".
    const players = "abcdefghi".split("").map(player); // 9 total, 8 others
    const colors = assignPlayerColors(players, "a");

    expect(colors.get("b")).toBe(OTHER_COLORS[0]);
    expect(colors.get("i")).toBe(OTHER_COLORS[0]);
  });
});
