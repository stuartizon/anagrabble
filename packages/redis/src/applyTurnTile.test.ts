// Integration tests against a real Redis (not a mock) — see CLAUDE.md
// "Testing strategy": this is the first real Lua script in the repo, so it
// gets the real-Redis coverage that section calls for, specifically
// including the concurrent-race case the atomicity exists to protect
// against.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { GameState } from "@anagrabble/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedisClient, type Redis } from "./client.js";
import { applyTurnTile, type ApplyTurnTileKeys } from "./applyTurnTile.js";

const GAME_ID = "game-1";
const KEYS: ApplyTurnTileKeys = {
  stateKey: `game:{${GAME_ID}}:state`,
  seqKey: `game:{${GAME_ID}}:seq`,
  cmdsKey: `game:{${GAME_ID}}:cmds`,
  bagKey: `game:{${GAME_ID}}:bag`,
};

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    status: "playing",
    seq: 0,
    config: { turnTimerSec: 30, minWordLength: 3, language: "en" },
    turnPlayerId: "p1",
    turnDeadline: Date.now() + 30_000,
    endGameDeadline: null,
    bankCount: 5,
    pool: [],
    players: [
      { id: "p1", name: "One", words: [], score: 0 },
      { id: "p2", name: "Two", words: [], score: 0 },
      { id: "p3", name: "Three", words: [], score: 0 },
    ],
    ...overrides,
  };
}

describe("applyTurnTile", () => {
  let container: StartedRedisContainer;
  let redis: Redis;

  beforeAll(async () => {
    container = await new RedisContainer("redis:7-alpine").start();
    redis = createRedisClient({ url: container.getConnectionUrl() });
    await redis.connect();
  }, 60_000);

  afterAll(async () => {
    redis.destroy();
    await container.stop();
  });

  beforeEach(async () => {
    await redis.flushAll();
  });

  async function seed(state: GameState, bag: string[] = ["A", "B", "C", "D", "E"]) {
    await redis.set(KEYS.stateKey, JSON.stringify(state));
    if (bag.length > 0) await redis.rPush(KEYS.bagKey, bag);
  }

  it("returns GameNotFound when the game doesn't exist", async () => {
    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now: Date.now(),
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toEqual({ error: "GameNotFound" });
  });

  it("returns GameNotStarted when the game is still in the lobby", async () => {
    await seed(makeState({ status: "lobby" }));

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now: Date.now(),
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toEqual({ error: "GameNotStarted" });
  });

  it("lets the current player turn a tile, advancing the turn and resetting the deadline", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerId: "p1", turnDeadline: now + 30_000 }));

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toMatchObject({
      state: {
        pool: ["A"],
        bankCount: 4,
        turnPlayerId: "p2",
        turnDeadline: now + 30_000,
        seq: 1,
      },
    });
  });

  it("rejects a non-current player before the deadline", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerId: "p1", turnDeadline: now + 30_000 }));

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p2",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toEqual({ error: "NotYourTurn" });
    const raw = await redis.get(KEYS.stateKey);
    expect((JSON.parse(raw!) as GameState).pool).toEqual([]);
  });

  it("lets any player turn a tile once the deadline has passed", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerId: "p1", turnDeadline: now - 1 }));

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p2",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toMatchObject({ state: { pool: ["A"], turnPlayerId: "p2" } });
  });

  it("lets another player force the turn once the current player has gone stale, well before turnDeadline", async () => {
    const now = Date.now();
    await seed(
      makeState({
        turnPlayerId: "p1",
        turnDeadline: now + 30_000, // far in the future — not why this succeeds
        players: [
          { id: "p1", name: "One", words: [], score: 0, lastSeenAt: now - 25_000 }, // stale
          { id: "p2", name: "Two", words: [], score: 0, lastSeenAt: now },
          { id: "p3", name: "Three", words: [], score: 0, lastSeenAt: now },
        ],
      }),
    );

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p2",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toMatchObject({ state: { pool: ["A"], turnPlayerId: "p2" } });
  });

  it("still rejects a non-current player while the current player is only briefly quiet", async () => {
    const now = Date.now();
    await seed(
      makeState({
        turnPlayerId: "p1",
        turnDeadline: now + 30_000,
        players: [
          { id: "p1", name: "One", words: [], score: 0, lastSeenAt: now - 5_000 }, // a blip, not stale
          { id: "p2", name: "Two", words: [], score: 0, lastSeenAt: now },
          { id: "p3", name: "Three", words: [], score: 0, lastSeenAt: now },
        ],
      }),
    );

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p2",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toEqual({ error: "NotYourTurn" });
  });

  it("is a no-op in a solo game once the only player has gone stale, rather than nulling turnPlayerId and burning a tile", async () => {
    // Regression test: apply_turn_tile.lua used to draw a tile and commit
    // to a mutation *before* checking whether anyone was actually reachable
    // to receive the turn. In a solo game, the sole player being unreachable
    // (the very reason the sweep fired) meant the walk found no candidate,
    // so turnPlayerId got set to null — a wasted tile draw and a broken
    // "Someone's turn" UI with no button to click, until a second sweep
    // pass reassigned it back to them once they reconnected. See
    // docs/decisions.md "Turn-timer polling sweep" → "Solo-game turn
    // nulling".
    const now = Date.now();
    await seed(
      makeState({
        turnPlayerId: "p1",
        turnDeadline: now + 30_000, // far away — not why this fires
        bankCount: 5,
        players: [{ id: "p1", name: "One", words: [], score: 0, lastSeenAt: now - 25_000 }], // stale
      }),
    );

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "turn-timer-sweep",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toMatchObject({
      state: { pool: [], bankCount: 5, turnPlayerId: "p1" },
    });
    const raw = await redis.get(KEYS.stateKey);
    expect((JSON.parse(raw!) as GameState).pool).toEqual([]);
  });

  it("is a no-op when every player is unreachable, the fully pathological multiplayer case", async () => {
    const now = Date.now();
    await seed(
      makeState({
        turnPlayerId: "p1",
        turnDeadline: now + 30_000,
        bankCount: 5,
        players: [
          { id: "p1", name: "One", words: [], score: 0, lastSeenAt: now - 25_000 },
          { id: "p2", name: "Two", words: [], score: 0, lastSeenAt: now - 25_000 },
          { id: "p3", name: "Three", words: [], score: 0, lastSeenAt: now - 25_000 },
        ],
      }),
    );

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "turn-timer-sweep",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toMatchObject({
      state: { pool: [], bankCount: 5, turnPlayerId: "p1" },
    });
  });

  it("advancing off a reachable player skips a subsequently-unreachable one, instead of handing them the turn", async () => {
    // Regression test for the bug in docs/decisions.md "Turn ownership:
    // turnPlayerIndex -> identity-based, not array position": with a
    // position-based turnPlayerIndex, p1 (reachable, current) turning a
    // tile would advance the index straight onto p2 even though p2 is
    // unreachable — handing them a turn nobody would ever take normally.
    // That's what let a client's own background fast-skip effect fire a
    // second TurnTile immediately after this one returned (since the new
    // "current player" reads as unreachable right away), silently drawing
    // a second tile for one click. The fix must walk straight past p2 and
    // land back on p1, the only reachable player, in this same call.
    const now = Date.now();
    await seed(
      makeState({
        turnPlayerId: "p1",
        turnDeadline: now + 30_000,
        bankCount: 5,
        players: [
          { id: "p1", name: "One", words: [], score: 0, lastSeenAt: now },
          { id: "p2", name: "Two", words: [], score: 0, lastSeenAt: now - 25_000 }, // stale
        ],
      }),
    );

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    // Turn stays with p1 (the only reachable player) — never handed to the
    // unreachable p2, and only one tile drawn for the one call made.
    expect(result).toMatchObject({
      state: { pool: ["A"], bankCount: 4, turnPlayerId: "p1" },
    });
  });

  it("walks past a run of several consecutive unreachable players without drawing for any of them", async () => {
    const now = Date.now();
    await seed(
      makeState({
        turnPlayerId: "p1",
        turnDeadline: now + 30_000,
        bankCount: 5,
        players: [
          { id: "p1", name: "One", words: [], score: 0, lastSeenAt: now },
          { id: "p2", name: "Two", words: [], score: 0, lastSeenAt: now - 25_000 }, // stale
          { id: "p3", name: "Three", words: [], score: 0, lastSeenAt: now - 25_000 }, // stale
          { id: "p4", name: "Four", words: [], score: 0, lastSeenAt: now },
        ],
      }),
    );

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    // Exactly one tile drawn (not one per skipped player), landing on p4,
    // straight past both unreachable players in between.
    expect(result).toMatchObject({
      state: { pool: ["A"], bankCount: 4, turnPlayerId: "p4" },
    });
  });

  it("is idempotent when retried with the same commandId", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerId: "p1", turnDeadline: now + 30_000 }));
    const commandId = crypto.randomUUID();

    const first = await applyTurnTile(redis, {
      ...KEYS,
      commandId,
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });
    const second = await applyTurnTile(redis, {
      ...KEYS,
      commandId,
      playerId: "p1",
      now: now + 5000,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(second).toEqual(first);
  });

  it("is a no-op once the bank is empty", async () => {
    const now = Date.now();
    await seed(makeState({ bankCount: 0, turnPlayerId: "p1", turnDeadline: now + 30_000 }), []);

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toMatchObject({ state: { bankCount: 0, pool: [] } });
  });

  it("sets endGameDeadline once the last tile is drawn", async () => {
    const now = Date.now();
    await seed(makeState({ bankCount: 1, turnPlayerId: "p1", turnDeadline: now + 30_000 }), ["Z"]);

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    expect(result).toMatchObject({ state: { bankCount: 0, endGameDeadline: now + 60_000 } });
  });

  it("keeps players[].words as an array through the Lua round-trip", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerId: "p1", turnDeadline: now + 30_000 }));

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
      presenceStaleMs: 10_000,
    });

    if (!("state" in result)) throw new Error("expected success");
    expect(Array.isArray(result.state.players[0].words)).toBe(true);
    expect(Array.isArray(result.state.players[1].words)).toBe(true);
    // Also verify the raw stored bytes, not just what JSON.parse tolerates.
    const raw = await redis.get(KEYS.stateKey);
    expect(raw).toContain('"words":[]');
    expect(raw).not.toContain('"words":{}');
  });

  it("advances the turn exactly once when two other clients race the same missed deadline", async () => {
    // Both p2 and p3 see the same expired deadline and fire at once. Only
    // one should actually win: whichever the atomic script applies first
    // resets the deadline into the future for the new current player, so
    // the loser's stale "deadline passed" premise is no longer true by the
    // time its own script body runs — the point of the Lua atomicity is
    // exactly this, no double-advance/lost-update from the race.
    const now = Date.now();
    await seed(makeState({ turnPlayerId: "p1", turnDeadline: now - 1, bankCount: 5 }));

    const [a, b] = await Promise.all([
      applyTurnTile(redis, {
        ...KEYS,
        commandId: crypto.randomUUID(),
        playerId: "p2",
        now,
        cmdsTtlSec: 3600,
        presenceStaleMs: 10_000,
      }),
      applyTurnTile(redis, {
        ...KEYS,
        commandId: crypto.randomUUID(),
        playerId: "p3",
        now,
        cmdsTtlSec: 3600,
        presenceStaleMs: 10_000,
      }),
    ]);

    const results = [a, b];
    const winners = results.filter((r) => !("error" in r));
    const losers = results.filter((r) => "error" in r);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([{ error: "NotYourTurn" }]);

    const raw = await redis.get(KEYS.stateKey);
    const finalState = JSON.parse(raw!) as GameState;
    expect(finalState.bankCount).toBe(4);
    expect(finalState.pool).toHaveLength(1);
    expect(finalState.seq).toBe(1);
    expect(finalState.turnPlayerId).toBe("p2");
  });

  it("draws exactly once in a two-player game when two sweep instances race the same missed deadline", async () => {
    // Regression test underpinning removing the old observedTurnDeadline
    // staleness guard (docs/decisions.md "Two-player double-tile-draw
    // bug"): that guard existed because a real *client's* stale call could
    // land just after turnPlayerId flipped onto that exact browser's own
    // player, satisfying isCurrentPlayer for the wrong reason. The server
    // sweep (apps/server/src/turnTimerSweep.ts) replaced client-triggered
    // firing and never claims a specific player identity, so this same
    // playerId-here can't ever coincidentally match whoever the turn
    // advances to — two concurrent sweep calls (same as two Node instances
    // independently sweeping the same overdue game) must still only draw
    // once, without needing an observed-deadline guard to tell them apart.
    const now = Date.now();
    await seed(makeState({ turnPlayerId: "p1", turnDeadline: now - 1, bankCount: 5 }));

    const [a, b] = await Promise.all([
      applyTurnTile(redis, {
        ...KEYS,
        commandId: crypto.randomUUID(),
        playerId: "turn-timer-sweep",
        now,
        cmdsTtlSec: 3600,
        presenceStaleMs: 10_000,
      }),
      applyTurnTile(redis, {
        ...KEYS,
        commandId: crypto.randomUUID(),
        playerId: "turn-timer-sweep",
        now,
        cmdsTtlSec: 3600,
        presenceStaleMs: 10_000,
      }),
    ]);

    const results = [a, b];
    const winners = results.filter((r) => !("error" in r));
    const losers = results.filter((r) => "error" in r);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([{ error: "NotYourTurn" }]);

    const raw = await redis.get(KEYS.stateKey);
    const finalState = JSON.parse(raw!) as GameState;
    expect(finalState.bankCount).toBe(4);
    expect(finalState.pool).toHaveLength(1);
    expect(finalState.seq).toBe(1);
    expect(finalState.turnPlayerId).toBe("p2");
  });
});
