// Integration tests against a real Redis (not a mock) — see CLAUDE.md
// "Testing strategy" and the same reasoning as applyTurnTile.test.ts: this
// script's whole reason to exist is atomicity under real EVAL semantics,
// including the concurrent-race case (two overlapping word claims), the
// specific race this script/the wider Redis architecture exists to resolve.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { GameState } from "@anagrabble/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { createRedisClient } from "./client.js";
import { applySubmitWord, type ApplySubmitWordKeys } from "./applySubmitWord.js";

const GAME_ID = "game-1";
const KEYS: ApplySubmitWordKeys = {
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
    turnDeadline: Date.now() + 30_000,
    endGameDeadline: null,
    bankCount: 100,
    pool: ["C", "A", "T", "S"],
    players: [
      { id: "p1", name: "One", words: [], score: 0 },
      { id: "p2", name: "Two", words: ["cat"], score: 1 },
      { id: "p3", name: "Three", words: [], score: 0 },
    ],
    ...overrides,
  };
}

describe("applySubmitWord", () => {
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
    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now: Date.now(),
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [],
      usedPoolLetters: [],
    });
    expect(result).toEqual({ error: "GameNotFound" });
  });

  it("returns GameNotStarted when the game is still in the lobby", async () => {
    await seed(makeState({ status: "lobby" }));
    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now: Date.now(),
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [],
      usedPoolLetters: [],
    });
    expect(result).toEqual({ error: "GameNotStarted" });
  });

  it("returns PlayerNotFound when the submitter isn't in the game", async () => {
    await seed(makeState());
    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "ghost",
      now: Date.now(),
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [],
      usedPoolLetters: [],
    });
    expect(result).toEqual({ error: "PlayerNotFound" });
  });

  it("lets a different player independently claim a word someone else already has", async () => {
    // p2 already has "cat" (default fixture); p1 builds their own from the
    // pool. Duplicate claims of the identical word are allowed as long as
    // the letters are genuinely available each time — see docs/decisions.md
    // "Duplicate word claims are allowed".
    await seed(makeState());
    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now: Date.now(),
      cmdsTtlSec: 3600,
      word: "cat",
      usedWords: [],
      usedPoolLetters: ["C", "A", "T"],
    });

    if (!("state" in result)) throw new Error("expected success");
    expect(result.state.players[0]).toMatchObject({ id: "p1", words: ["cat"], score: 1 });
    expect(result.state.players[1]).toMatchObject({ id: "p2", words: ["cat"], score: 1 });
    expect(result.state.pool).toEqual(["S"]);
  });

  it("lets the same player claim a second, independent copy of their own word", async () => {
    await seed(
      makeState({
        pool: ["C", "A", "T"],
        players: [{ id: "p1", name: "One", words: ["cat"], score: 1 }],
      }),
    );
    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now: Date.now(),
      cmdsTtlSec: 3600,
      word: "cat",
      usedWords: [],
      usedPoolLetters: ["C", "A", "T"],
    });

    if (!("state" in result)) throw new Error("expected success");
    // Score stacks — each independent claim scores on its own, no discount
    // for a repeat (Stuart, confirmed: "pure score stacking").
    expect(result.state.players[0]).toMatchObject({ id: "p1", words: ["cat", "cat"], score: 2 });
    expect(result.state.pool).toEqual([]);
  });

  it("applies a pool-only play: adds the word, scores it, transfers the turn", async () => {
    const now = Date.now();
    await seed(
      makeState({
        pool: ["C", "A", "T"],
        turnPlayerId: "p3",
        turnDeadline: now + 5000,
        // No pre-existing claims here — this test is specifically about a
        // fresh pool-only claim, not a steal (see the dedicated steal test
        // below for that, which relies on the default fixture's p2:["cat"]).
        players: [
          { id: "p1", name: "One", words: [], score: 0 },
          { id: "p2", name: "Two", words: [], score: 0 },
          { id: "p3", name: "Three", words: [], score: 0 },
        ],
      }),
    );

    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now,
      cmdsTtlSec: 3600,
      word: "cat",
      usedWords: [],
      usedPoolLetters: ["C", "A", "T"],
    });

    expect(result).toMatchObject({
      state: {
        pool: [],
        turnPlayerId: "p1",
        turnDeadline: now + 30_000,
        seq: 1,
      },
    });
    if (!("state" in result)) throw new Error("expected success");
    expect(result.state.players[0]).toMatchObject({ id: "p1", words: ["cat"], score: 1 });
  });

  it("applies a steal: removes the word from its owner, rescoring both players", async () => {
    const now = Date.now();
    await seed(makeState());

    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now,
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [{ word: "cat", ownerId: "p2" }],
      usedPoolLetters: ["S"],
    });

    if (!("state" in result)) throw new Error("expected success");
    expect(result.state.players[0]).toMatchObject({ id: "p1", words: ["cast"], score: 2 });
    expect(result.state.players[1]).toMatchObject({ id: "p2", words: [], score: 0 });
    expect(result.state.pool).toEqual(["C", "A", "T"]);
    expect(result.state.turnPlayerId).toBe("p1");
  });

  it("returns StaleState when a used word is no longer owned where it was read", async () => {
    // p2 no longer has "cat" by the time this runs — someone else took it
    // between the Node-side search and this call.
    await seed(
      makeState({
        players: [
          { id: "p1", name: "One", words: [], score: 0 },
          { id: "p2", name: "Two", words: [], score: 0 },
          { id: "p3", name: "Three", words: [], score: 0 },
        ],
      }),
    );

    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now: Date.now(),
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [{ word: "cat", ownerId: "p2" }],
      usedPoolLetters: ["S"],
    });

    expect(result).toEqual({ error: "StaleState" });
    const raw = await redis.get(KEYS.stateKey);
    expect((JSON.parse(raw!) as GameState).pool).toEqual(["C", "A", "T", "S"]);
  });

  it("returns StaleState when the pool no longer has a claimed letter", async () => {
    await seed(makeState({ pool: ["C", "A", "T"] })); // no "S" left

    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now: Date.now(),
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [{ word: "cat", ownerId: "p2" }],
      usedPoolLetters: ["S"],
    });

    expect(result).toEqual({ error: "StaleState" });
  });

  it("is idempotent when retried with the same commandId", async () => {
    await seed(makeState());
    const commandId = crypto.randomUUID();
    const args = {
      ...KEYS,
      commandId,
      submitterId: "p1",
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [{ word: "cat", ownerId: "p2" }],
      usedPoolLetters: ["S"],
    };

    const first = await applySubmitWord(redis, { ...args, now: Date.now() });
    const second = await applySubmitWord(redis, { ...args, now: Date.now() + 5000 });

    expect(second).toEqual(first);
  });

  it("resets endGameDeadline only once the idle countdown has already started", async () => {
    const now = Date.now();

    // Bank still has tiles: endGameDeadline stays null.
    await seed(makeState({ bankCount: 50, endGameDeadline: null }));
    const stillPlaying = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now,
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [{ word: "cat", ownerId: "p2" }],
      usedPoolLetters: ["S"],
    });
    expect(stillPlaying).toMatchObject({ state: { endGameDeadline: null } });

    // Bank empty, countdown already running: gets reset to now + 60s.
    await redis.flushall();
    await seed(makeState({ bankCount: 0, endGameDeadline: now + 10_000 }));
    const bankEmpty = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now,
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [{ word: "cat", ownerId: "p2" }],
      usedPoolLetters: ["S"],
    });
    expect(bankEmpty).toMatchObject({ state: { endGameDeadline: now + 60_000 } });
  });

  it("keeps players[].words and pool as arrays through the Lua round-trip when emptied", async () => {
    const now = Date.now();
    await seed(
      makeState({
        pool: ["S"],
        players: [
          { id: "p1", name: "One", words: [], score: 0 },
          { id: "p2", name: "Two", words: ["cat"], score: 1 },
        ],
      }),
    );

    const result = await applySubmitWord(redis, {
      ...KEYS,
      commandId: crypto.randomUUID(),
      submitterId: "p1",
      now,
      cmdsTtlSec: 3600,
      word: "cast",
      usedWords: [{ word: "cat", ownerId: "p2" }],
      usedPoolLetters: ["S"],
    });

    if (!("state" in result)) throw new Error("expected success");
    expect(result.state.pool).toEqual([]);
    expect(result.state.players[1].words).toEqual([]);
    const raw = await redis.get(KEYS.stateKey);
    expect(raw).toContain('"pool":[]');
    expect(raw).toContain('"words":[]');
    expect(raw).not.toContain('"pool":{}');
    expect(raw).not.toContain('"words":{}');
  });

  it("lets exactly one of two racing claims that need the same pool letter win", async () => {
    // p1 claims CAT(p2) + S -> CAST; p3 (independently) claims TAR(p4) + S ->
    // RATS. Both are individually valid decompositions and don't touch the
    // same claimed word, but there's only one "S" tile in the pool — only
    // one of these two atomic scripts can win it.
    await seed(
      makeState({
        pool: ["S"],
        players: [
          { id: "p1", name: "One", words: [], score: 0 },
          { id: "p2", name: "Two", words: ["cat"], score: 1 },
          { id: "p3", name: "Three", words: [], score: 0 },
          { id: "p4", name: "Four", words: ["tar"], score: 1 },
        ],
      }),
    );
    const now = Date.now();

    const [a, b] = await Promise.all([
      applySubmitWord(redis, {
        ...KEYS,
        commandId: crypto.randomUUID(),
        submitterId: "p1",
        now,
        cmdsTtlSec: 3600,
        word: "cast",
        usedWords: [{ word: "cat", ownerId: "p2" }],
        usedPoolLetters: ["S"],
      }),
      applySubmitWord(redis, {
        ...KEYS,
        commandId: crypto.randomUUID(),
        submitterId: "p3",
        now,
        cmdsTtlSec: 3600,
        word: "rats",
        usedWords: [{ word: "tar", ownerId: "p4" }],
        usedPoolLetters: ["S"],
      }),
    ]);

    const results = [a, b];
    const winners = results.filter((r) => "state" in r);
    const losers = results.filter((r) => "error" in r);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([{ error: "StaleState" }]);

    const raw = await redis.get(KEYS.stateKey);
    const finalState = JSON.parse(raw!) as GameState;
    expect(finalState.pool).toEqual([]);
    expect(finalState.seq).toBe(1);
    // Exactly one of the two claims actually landed: either p1's (cat -> cast,
    // p4's tar untouched) or p3's (tar -> rats, p2's cat untouched).
    const allWords = finalState.players
      .flatMap((p) => p.words)
      .slice()
      .sort();
    expect(["cast,tar", "cat,rats"]).toContain(allWords.join(","));
  });
});
