// Integration tests against a real Redis (not a mock) — see CLAUDE.md
// "Testing strategy" and applyTurnTile.test.ts's header comment for why:
// the point is verifying atomic GET-patch-SET behavior under real EVAL
// semantics, not something a mock can stand in for.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { GameState } from "@anagrabble/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { createRedisClient } from "./client.js";
import { applyPresence } from "./applyPresence.js";

const GAME_ID = "game-1";
const STATE_KEY = `game:{${GAME_ID}}:state`;

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
      { id: "p1", name: "One", words: [], score: 0, lastSeenAt: 0 },
      { id: "p2", name: "Two", words: [], score: 0, lastSeenAt: 0 },
    ],
    ...overrides,
  };
}

describe("applyPresence", () => {
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

  async function seed(state: GameState) {
    await redis.set(STATE_KEY, JSON.stringify(state));
  }

  it("returns GameNotFound when the game doesn't exist", async () => {
    const result = await applyPresence(redis, {
      stateKey: STATE_KEY,
      playerId: "p1",
      lastSeenAt: Date.now(),
    });

    expect(result).toEqual({ error: "GameNotFound" });
  });

  it("stamps lastSeenAt for the given player only", async () => {
    await seed(makeState());
    const now = Date.now();

    const result = await applyPresence(redis, { stateKey: STATE_KEY, playerId: "p1", lastSeenAt: now });

    expect(result).toMatchObject({
      state: {
        players: [
          { id: "p1", lastSeenAt: now },
          { id: "p2", lastSeenAt: 0 },
        ],
      },
    });
  });

  it("can mark a player stale immediately (the on-close path)", async () => {
    await seed(makeState({ players: [{ id: "p1", name: "One", words: [], score: 0, lastSeenAt: Date.now() }] }));

    const result = await applyPresence(redis, { stateKey: STATE_KEY, playerId: "p1", lastSeenAt: 0 });

    expect(result).toMatchObject({ state: { players: [{ id: "p1", lastSeenAt: 0 }] } });
  });

  it("no-ops for a player who isn't in the game", async () => {
    await seed(makeState());

    const result = await applyPresence(redis, {
      stateKey: STATE_KEY,
      playerId: "ghost",
      lastSeenAt: Date.now(),
    });

    expect(result).toMatchObject({ state: { players: [{ id: "p1", lastSeenAt: 0 }, { id: "p2", lastSeenAt: 0 }] } });
  });

  it("doesn't clobber a concurrent state change (round-trips other fields untouched)", async () => {
    await seed(makeState({ bankCount: 3, pool: ["A", "B"] }));

    const result = await applyPresence(redis, {
      stateKey: STATE_KEY,
      playerId: "p1",
      lastSeenAt: Date.now(),
    });

    expect(result).toMatchObject({ state: { bankCount: 3, pool: ["A", "B"] } });
  });

  it("round-trips an empty pool as an array, not an object", async () => {
    await seed(makeState({ pool: [] }));

    const result = await applyPresence(redis, {
      stateKey: STATE_KEY,
      playerId: "p1",
      lastSeenAt: Date.now(),
    });

    if (!("state" in result)) throw new Error("expected success");
    expect(Array.isArray(result.state.pool)).toBe(true);
    const raw = await redis.get(STATE_KEY);
    expect(raw).toContain('"pool":[]');
  });
});
