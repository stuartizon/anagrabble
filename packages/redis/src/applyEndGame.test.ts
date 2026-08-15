// Integration tests against a real Redis (not a mock) — see CLAUDE.md
// "Testing strategy", same rationale/harness as applyTurnTile.test.ts,
// including the concurrent-race case: two clients' idle timers can both
// expire and fire EndGame in the same window, and only one should actually
// perform the status transition.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { GameState } from "@anagrabble/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { createRedisClient } from "./client.js";
import { applyEndGame, type ApplyEndGameKeys } from "./applyEndGame.js";

const GAME_ID = "game-1";
const KEYS: ApplyEndGameKeys = {
  stateKey: `game:{${GAME_ID}}:state`,
  seqKey: `game:{${GAME_ID}}:seq`,
  cmdsKey: `game:{${GAME_ID}}:cmds`,
};

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    status: "playing",
    seq: 0,
    config: { turnTimerSec: 30, minWordLength: 3, language: "en" },
    turnPlayerId: "p1",
    turnDeadline: null,
    endGameDeadline: null,
    bankCount: 0,
    pool: ["A", "B", "C"],
    players: [
      { id: "p1", name: "One", words: [], score: 0 },
      { id: "p2", name: "Two", words: [], score: 0 },
    ],
    ...overrides,
  };
}

describe("applyEndGame", () => {
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
    await redis.set(KEYS.stateKey, JSON.stringify(state));
  }

  it("returns GameNotFound when the game doesn't exist", async () => {
    const result = await applyEndGame(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      now: Date.now(),
      cmdsTtlSec: 3600,
    });

    expect(result).toEqual({ error: "GameNotFound" });
  });

  it("returns GameNotStarted when the game is still in the lobby", async () => {
    await seed(makeState({ status: "lobby" }));

    const result = await applyEndGame(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      now: Date.now(),
      cmdsTtlSec: 3600,
    });

    expect(result).toEqual({ error: "GameNotStarted" });
  });

  it("returns GameNotIdle when endGameDeadline is still null", async () => {
    await seed(makeState({ endGameDeadline: null }));

    const result = await applyEndGame(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      now: Date.now(),
      cmdsTtlSec: 3600,
    });

    expect(result).toEqual({ error: "GameNotIdle" });
  });

  it("returns GameNotIdle when endGameDeadline is still in the future", async () => {
    const now = Date.now();
    await seed(makeState({ endGameDeadline: now + 60_000 }));

    const result = await applyEndGame(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      now,
      cmdsTtlSec: 3600,
    });

    expect(result).toEqual({ error: "GameNotIdle" });
  });

  it("ends the game once the idle deadline has passed", async () => {
    const now = Date.now();
    await seed(makeState({ endGameDeadline: now - 1 }));

    const result = await applyEndGame(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      now,
      cmdsTtlSec: 3600,
    });

    expect(result).toMatchObject({ state: { status: "ended", seq: 1 } });
  });

  it("is a no-op success when the game is already ended", async () => {
    const now = Date.now();
    await seed(makeState({ status: "ended", endGameDeadline: now - 1, seq: 3 }));

    const result = await applyEndGame(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      now,
      cmdsTtlSec: 3600,
    });

    expect(result).toMatchObject({ state: { status: "ended", seq: 3 } });
  });

  it("is idempotent when retried with the same commandId", async () => {
    const now = Date.now();
    await seed(makeState({ endGameDeadline: now - 1 }));
    const commandId = crypto.randomUUID();

    const first = await applyEndGame(redis, { ...KEYS, commandId, now, cmdsTtlSec: 3600 });
    const second = await applyEndGame(redis, {
      ...KEYS,
      commandId,
      now: now + 5000,
      cmdsTtlSec: 3600,
    });

    expect(second).toEqual(first);
  });

  it("ends the game exactly once when two clients race the same missed deadline", async () => {
    // Two different clients' idle timers both fire at once with different
    // commandIds. Only the first script execution should actually flip
    // status/bump seq — the second's atomic run sees status already
    // 'ended' and returns the same no-op result, not an error and not a
    // second mutation.
    const now = Date.now();
    await seed(makeState({ endGameDeadline: now - 1 }));

    const [a, b] = await Promise.all([
      applyEndGame(redis, { ...KEYS, commandId: crypto.randomUUID(), now, cmdsTtlSec: 3600 }),
      applyEndGame(redis, { ...KEYS, commandId: crypto.randomUUID(), now, cmdsTtlSec: 3600 }),
    ]);

    expect("error" in a).toBe(false);
    expect("error" in b).toBe(false);

    const raw = await redis.get(KEYS.stateKey);
    const finalState = JSON.parse(raw!) as GameState;
    expect(finalState.status).toBe("ended");
    expect(finalState.seq).toBe(1);
  });
});
