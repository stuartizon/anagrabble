// Integration tests against a real Redis (not a mock) — see CLAUDE.md
// "Testing strategy": this is the first real Lua script in the repo, so it
// gets the real-Redis coverage that section calls for, specifically
// including the concurrent-race case the atomicity exists to protect
// against.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { GameState } from "@anagrabble/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { createRedisClient } from "./client.js";
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
    turnPlayerIndex: 0,
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
  }, 60_000);

  afterAll(async () => {
    redis.disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  async function seed(state: GameState, bag: string[] = ["A", "B", "C", "D", "E"]) {
    await redis.set(KEYS.stateKey, JSON.stringify(state));
    if (bag.length > 0) await redis.rpush(KEYS.bagKey, ...bag);
  }

  it("returns GameNotFound when the game doesn't exist", async () => {
    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now: Date.now(),
      cmdsTtlSec: 3600,
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
    });

    expect(result).toEqual({ error: "GameNotStarted" });
  });

  it("lets the current player turn a tile, advancing the turn and resetting the deadline", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerIndex: 0, turnDeadline: now + 30_000 }));

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
    });

    expect(result).toMatchObject({
      state: {
        pool: ["A"],
        bankCount: 4,
        turnPlayerIndex: 1,
        turnDeadline: now + 30_000,
        seq: 1,
      },
    });
  });

  it("rejects a non-current player before the deadline", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerIndex: 0, turnDeadline: now + 30_000 }));

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p2",
      now,
      cmdsTtlSec: 3600,
    });

    expect(result).toEqual({ error: "NotYourTurn" });
    const raw = await redis.get(KEYS.stateKey);
    expect((JSON.parse(raw!) as GameState).pool).toEqual([]);
  });

  it("lets any player turn a tile once the deadline has passed", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerIndex: 0, turnDeadline: now - 1 }));

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p2",
      now,
      cmdsTtlSec: 3600,
    });

    expect(result).toMatchObject({ state: { pool: ["A"], turnPlayerIndex: 1 } });
  });

  it("lets another player force the turn once the current player has gone stale, well before turnDeadline", async () => {
    const now = Date.now();
    await seed(
      makeState({
        turnPlayerIndex: 0,
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
    });

    expect(result).toMatchObject({ state: { pool: ["A"], turnPlayerIndex: 1 } });
  });

  it("still rejects a non-current player while the current player is only briefly quiet", async () => {
    const now = Date.now();
    await seed(
      makeState({
        turnPlayerIndex: 0,
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
    });

    expect(result).toEqual({ error: "NotYourTurn" });
  });

  it("treats a current player who explicitly left as unreachable too", async () => {
    const now = Date.now();
    await seed(
      makeState({
        turnPlayerIndex: 0,
        turnDeadline: now + 30_000,
        players: [
          { id: "p1", name: "One", words: [], score: 0, lastSeenAt: now, left: true },
          { id: "p2", name: "Two", words: [], score: 0, lastSeenAt: now },
        ],
      }),
    );

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p2",
      now,
      cmdsTtlSec: 3600,
    });

    expect(result).toMatchObject({ state: { pool: ["A"], turnPlayerIndex: 1 } });
  });

  it("is idempotent when retried with the same commandId", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerIndex: 0, turnDeadline: now + 30_000 }));
    const commandId = crypto.randomUUID();

    const first = await applyTurnTile(redis, {
      ...KEYS,
      commandId,
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
    });
    const second = await applyTurnTile(redis, {
      ...KEYS,
      commandId,
      playerId: "p1",
      now: now + 5000,
      cmdsTtlSec: 3600,
    });

    expect(second).toEqual(first);
  });

  it("is a no-op once the bank is empty", async () => {
    const now = Date.now();
    await seed(makeState({ bankCount: 0, turnPlayerIndex: 0, turnDeadline: now + 30_000 }), []);

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
    });

    expect(result).toMatchObject({ state: { bankCount: 0, pool: [] } });
  });

  it("sets endGameDeadline once the last tile is drawn", async () => {
    const now = Date.now();
    await seed(makeState({ bankCount: 1, turnPlayerIndex: 0, turnDeadline: now + 30_000 }), ["Z"]);

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
    });

    expect(result).toMatchObject({ state: { bankCount: 0, endGameDeadline: now + 60_000 } });
  });

  it("keeps players[].words as an array through the Lua round-trip", async () => {
    const now = Date.now();
    await seed(makeState({ turnPlayerIndex: 0, turnDeadline: now + 30_000 }));

    const result = await applyTurnTile(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      playerId: "p1",
      now,
      cmdsTtlSec: 3600,
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
    await seed(makeState({ turnPlayerIndex: 0, turnDeadline: now - 1, bankCount: 5 }));

    const [a, b] = await Promise.all([
      applyTurnTile(redis, {
        ...KEYS,
        commandId: crypto.randomUUID(),
        playerId: "p2",
        now,
        cmdsTtlSec: 3600,
      }),
      applyTurnTile(redis, {
        ...KEYS,
        commandId: crypto.randomUUID(),
        playerId: "p3",
        now,
        cmdsTtlSec: 3600,
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
    expect(finalState.turnPlayerIndex).toBe(1);
  });
});
