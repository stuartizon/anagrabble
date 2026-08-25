// Integration test against a real Redis (not a mock) — same harness as
// game.test.ts. Real timers throughout (not vi.useFakeTimers): the sweep's
// own setInterval runs uncontrolled by the test, so assertions poll via
// vi.waitFor instead of ticking a fake clock.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { createRedisClient, type Redis } from "@anagrabble/redis";
import type { GameState } from "@anagrabble/protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bagKey,
  computeSweepDueAt,
  PRESENCE_STALE_MS,
  stateKey,
  TURN_DEADLINES_KEY,
} from "./gameSession.js";
import { startTurnTimerSweep, type TurnTimerSweep } from "./turnTimerSweep.js";
import type { Broadcaster } from "./broadcast.js";

const GAME_ID = "game-1";
const CONFIG = { turnTimerSec: 30, minWordLength: 3, language: "en" };

function makeState(overrides: Partial<GameState> = {}): GameState {
  const now = Date.now();
  return {
    status: "playing",
    seq: 0,
    config: CONFIG,
    turnPlayerId: "p1",
    turnDeadline: now - 1,
    endGameDeadline: null,
    bankCount: 5,
    pool: [],
    players: [
      { id: "p1", name: "One", words: [], score: 0, lastSeenAt: now },
      { id: "p2", name: "Two", words: [], score: 0, lastSeenAt: now },
    ],
    ...overrides,
  };
}

function fakeBroadcaster(): Broadcaster & { publish: ReturnType<typeof vi.fn> } {
  return {
    publish: vi.fn(async () => {}),
    joinRoom: () => {},
    leaveRoom: () => {},
    markDisconnected: () => {},
    close: async () => {},
  };
}

describe("turnTimerSweep", () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let sweep: TurnTimerSweep | null = null;

  beforeAll(async () => {
    container = await new RedisContainer("redis:7-alpine").start();
    redis = createRedisClient({ url: container.getConnectionUrl() });
    await redis.connect();
  }, 60_000);

  afterAll(async () => {
    // sweep.stop() (afterEach, below) only clears the interval — a tick
    // already in flight when the last test finished can still be mid-await
    // against `redis` here. Same grace-period pattern as server.test.ts's
    // afterAll, for the same reason (avoid a spurious "Disconnects client"
    // log from a fire-and-forget call outliving the client it used).
    await new Promise((resolve) => setTimeout(resolve, 100));
    redis.destroy();
    await container.stop();
  });

  beforeEach(async () => {
    await redis.flushAll();
  });

  afterEach(() => {
    sweep?.stop();
    sweep = null;
  });

  async function seed(state: GameState, bag: string[] = ["A", "B", "C", "D", "E"]) {
    await redis.set(stateKey(GAME_ID), JSON.stringify(state));
    if (bag.length > 0) await redis.rPush(bagKey(GAME_ID), bag);
    if (typeof state.turnDeadline === "number") {
      await redis.zAdd(TURN_DEADLINES_KEY, { score: state.turnDeadline, value: GAME_ID });
    }
  }

  async function readState(): Promise<GameState> {
    const raw = await redis.get(stateKey(GAME_ID));
    return JSON.parse(raw!) as GameState;
  }

  it("force-advances a turn once the deadline has passed, with nobody connected", async () => {
    await seed(makeState());
    const broadcaster = fakeBroadcaster();

    sweep = startTurnTimerSweep(redis, broadcaster);

    await vi.waitFor(
      async () => {
        const state = await readState();
        expect(state.turnPlayerId).toBe("p2");
        expect(state.bankCount).toBe(4);
        expect(broadcaster.publish).toHaveBeenCalledWith(
          expect.objectContaining({ type: "TileTurned", gameId: GAME_ID }),
        );
      },
      { timeout: 3000, interval: 50 },
    );
  });

  it("does not touch a game whose deadline hasn't passed yet", async () => {
    await seed(makeState({ turnDeadline: Date.now() + 30_000 }));
    const broadcaster = fakeBroadcaster();

    sweep = startTurnTimerSweep(redis, broadcaster);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const state = await readState();
    expect(state.turnPlayerId).toBe("p1");
    expect(state.bankCount).toBe(5);
    expect(broadcaster.publish).not.toHaveBeenCalled();
  });

  it("stops tracking a game once a swept turn empties the bank, so it isn't re-swept forever", async () => {
    await seed(makeState({ bankCount: 1 }), ["Z"]);
    const broadcaster = fakeBroadcaster();

    sweep = startTurnTimerSweep(redis, broadcaster);

    await vi.waitFor(
      async () => {
        const score = await redis.zScore(TURN_DEADLINES_KEY, GAME_ID);
        expect(score).toBeNull();
      },
      { timeout: 3000, interval: 50 },
    );
  });

  it("draws exactly once for a two-player game even though it polls repeatedly past the same expired deadline", async () => {
    // The sweep ticks every second and doesn't remove a game from
    // TURN_DEADLINES_KEY until the *result* of advancing it is applied, so
    // in principle the same overdue game could be picked up by more than
    // one tick's pass before the first one's mutation lands. Guards against
    // a regression re-introducing the double-tile-draw bug
    // (docs/decisions.md) now that observedTurnDeadline is gone.
    await seed(makeState());
    const broadcaster = fakeBroadcaster();

    sweep = startTurnTimerSweep(redis, broadcaster);

    await vi.waitFor(
      async () => {
        const state = await readState();
        expect(state.turnPlayerId).toBe("p2");
      },
      { timeout: 3000, interval: 50 },
    );

    // Let a couple more sweep intervals pass — a bug here would keep
    // drawing tiles every tick since the game stays "due" until its
    // deadline is pushed into the future.
    await new Promise((resolve) => setTimeout(resolve, 2200));

    const state = await readState();
    expect(state.bankCount).toBe(4);
    expect(state.pool).toHaveLength(1);
  });

  it("fast-skips a turn once the current player goes stale, well before the nominal turnDeadline (anagrabble#2 fast-skip fix)", async () => {
    // Regression test for the gap flagged in review: a naive sweep indexed
    // purely by turnDeadline never notices a current player going
    // unreachable mid-turn (CLAUDE.md "Disconnected-player fast-skip") —
    // it wouldn't even look at this game until the full turnTimerSec had
    // elapsed. computeSweepDueAt's min(turnDeadline, presence deadline)
    // formula is what fixes that; this proves it end to end through the
    // real sweep, not just the tracked score in isolation (game.test.ts
    // covers that half).
    const now = Date.now();
    const state = makeState({
      turnDeadline: now + 30_000, // far away — not why this fires
      players: [
        { id: "p1", name: "One", words: [], score: 0, lastSeenAt: now - PRESENCE_STALE_MS - 1 }, // already stale
        { id: "p2", name: "Two", words: [], score: 0, lastSeenAt: now },
      ],
    });
    await seed(state);
    // Overrides seed()'s plain turnDeadline-only score with the real
    // production formula (computeSweepDueAt is pure, so this can call it
    // directly and await the write deterministically), not a re-derived
    // one — so this fails if that formula ever stops accounting for
    // presence. syncTurnDeadlineTracking itself is fire-and-forget (see
    // docs/decisions.md "Sweep-tracking writes are fire-and-forget"), so
    // this test can't use it directly for deterministic setup.
    const dueAt = computeSweepDueAt(state);
    await redis.zAdd(TURN_DEADLINES_KEY, { score: dueAt!, value: GAME_ID });

    const broadcaster = fakeBroadcaster();
    sweep = startTurnTimerSweep(redis, broadcaster);

    await vi.waitFor(
      async () => {
        const advanced = await readState();
        expect(advanced.turnPlayerId).toBe("p2");
      },
      { timeout: 3000, interval: 50 },
    );
  });
});
