// Integration tests against a real Redis (not a mock) — see CLAUDE.md
// "Testing strategy", same rationale/harness as gameSession.test.ts. The
// TurnTile-specific atomicity/race coverage lives in
// packages/redis/src/applyTurnTile.test.ts (the Lua script itself); this
// file covers the apps/server wrapper: command validation, error codes, and
// wiring the result back into a GameSnapshot.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { createRedisClient, type Redis } from "@anagrabble/redis";
import type {
  EndGameCommand,
  GameSnapshot,
  GameState,
  JoinGameCommand,
  StartGameCommand,
  SubmitWordCommand,
  TurnTileCommand,
} from "@anagrabble/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGame, joinGame, stateKey, type CreateGameParams } from "./gameSession.js";
import { endGame, startGame, submitWord, turnTile } from "./game.js";

const CONFIG = { turnTimerSec: 30, minWordLength: 3, language: "en" };
const HOST_ID = "host-1";
const PLAYER_ID = "player-2";

function createGameCommand(overrides: Partial<CreateGameParams> = {}): CreateGameParams {
  return {
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    hostName: "Host",
    config: CONFIG,
    ...overrides,
  };
}

function joinGameCommand(overrides: Partial<JoinGameCommand> = {}): JoinGameCommand {
  return {
    type: "JoinGame",
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    playerName: "Player Two",
    ...overrides,
  };
}

function startGameCommand(overrides: Partial<StartGameCommand> = {}): StartGameCommand {
  return {
    type: "StartGame",
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    ...overrides,
  };
}

function turnTileCommand(overrides: Partial<TurnTileCommand> = {}): TurnTileCommand {
  return {
    type: "TurnTile",
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    ...overrides,
  };
}

function endGameCommand(overrides: Partial<EndGameCommand> = {}): EndGameCommand {
  return {
    type: "EndGame",
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    ...overrides,
  };
}

function submitWordCommand(overrides: Partial<SubmitWordCommand> = {}): SubmitWordCommand {
  return {
    type: "SubmitWord",
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    word: "cat",
    ...overrides,
  };
}

describe("game", () => {
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

  async function seedTwoPlayerLobby() {
    await createGame(redis, createGameCommand(), HOST_ID);
    await joinGame(redis, joinGameCommand(), PLAYER_ID);
  }

  /** Backdates the host's lastSeenAt past PRESENCE_STALE_MS, so
   * deriveHostId (gameSession.ts) treats them as unreachable and host status
   * migrates to the next reachable player. */
  async function makeHostStale() {
    const raw = await redis.get(stateKey("game-1"));
    const state = JSON.parse(raw!) as GameState;
    state.players = state.players.map((p) =>
      p.id === HOST_ID ? { ...p, lastSeenAt: Date.now() - 25_000 } : p,
    );
    await redis.set(stateKey("game-1"), JSON.stringify(state));
  }

  /** A deterministic `playing` state (pool/claimed words as given), bypassing
   * startGame's random bag shuffle — submitWord tests need to control
   * exactly what's on the board, not just that a game has started. */
  async function seedPlayingState(overrides: Partial<GameState> = {}) {
    const state: GameState = {
      status: "playing",
      seq: 0,
      config: CONFIG,
      turnPlayerId: "host-1",
      turnDeadline: Date.now() + CONFIG.turnTimerSec * 1000,
      endGameDeadline: null,
      bankCount: 100,
      pool: ["C", "A", "T"],
      players: [
        { id: "host-1", name: "Host", words: [], score: 0 },
        { id: "player-2", name: "Player Two", words: [], score: 0 },
      ],
      ...overrides,
    };
    await redis.set(stateKey("game-1"), JSON.stringify(state));
  }

  describe("startGame", () => {
    it("returns GameNotFound for an unknown game", async () => {
      const result = await startGame(redis, startGameCommand(), HOST_ID);
      expect(result).toEqual({ error: "GameNotFound" });
    });

    it("rejects a non-host caller", async () => {
      await seedTwoPlayerLobby();
      const result = await startGame(redis, startGameCommand(), PLAYER_ID);
      expect(result).toEqual({ error: "NotHost" });
    });

    it("allows the host to start solo, with just one player", async () => {
      await createGame(redis, createGameCommand(), HOST_ID);
      const result = await startGame(redis, startGameCommand(), HOST_ID);
      expect(result).not.toHaveProperty("error");
      const { snapshot } = result as { snapshot: GameSnapshot };
      expect(snapshot.status).toBe("playing");
    });

    it("rejects starting a game that's already playing", async () => {
      await seedTwoPlayerLobby();
      await startGame(redis, startGameCommand(), HOST_ID);
      const result = await startGame(
        redis,
        startGameCommand({ commandId: crypto.randomUUID() }),
        HOST_ID,
      );
      expect(result).toEqual({ error: "GameAlreadyStarted" });
    });

    it("shuffles a full bag and opens the first turn", async () => {
      await seedTwoPlayerLobby();
      const before = Date.now();

      const result = await startGame(redis, startGameCommand(), HOST_ID);

      expect(result).not.toHaveProperty("error");
      const { snapshot } = result as { snapshot: GameSnapshot };
      expect(snapshot.status).toBe("playing");
      expect(snapshot.turnPlayerId).toBe(HOST_ID);
      expect(snapshot.bankCount).toBe(144);
      expect(snapshot.pool).toEqual([]);
      expect(snapshot.turnDeadline).not.toBeNull();
      expect(snapshot.turnDeadline!).toBeGreaterThanOrEqual(before + CONFIG.turnTimerSec * 1000);

      const bagLength = await redis.lLen("game:{game-1}:bag");
      expect(bagLength).toBe(144);
    });

    it("is idempotent when retried with the same commandId", async () => {
      await seedTwoPlayerLobby();
      const cmd = startGameCommand();

      const first = await startGame(redis, cmd, HOST_ID);
      const second = await startGame(redis, cmd, HOST_ID);

      expect(second).toEqual(first);
      const bagLength = await redis.lLen("game:{game-1}:bag");
      expect(bagLength).toBe(144);
    });

    it("lets a reachable player start once the original host has gone stale", async () => {
      await seedTwoPlayerLobby();
      await makeHostStale();

      const result = await startGame(redis, startGameCommand(), PLAYER_ID);

      expect(result).not.toHaveProperty("error");
      const { snapshot } = result as { snapshot: GameSnapshot };
      expect(snapshot.status).toBe("playing");
      expect(snapshot.players.map((p) => p.id)).toEqual([HOST_ID, PLAYER_ID]);
    });
  });

  describe("turnTile", () => {
    it("returns GameNotStarted for a game still in the lobby", async () => {
      await seedTwoPlayerLobby();
      const result = await turnTile(redis, turnTileCommand(), HOST_ID);
      expect(result).toEqual({ error: "GameNotStarted" });
    });

    it("lets the current player turn a tile", async () => {
      await seedTwoPlayerLobby();
      await startGame(redis, startGameCommand(), HOST_ID);

      const result = await turnTile(redis, turnTileCommand(), HOST_ID);

      expect(result).not.toHaveProperty("error");
      const { snapshot } = result as { snapshot: GameSnapshot };
      expect(snapshot.pool).toHaveLength(1);
      expect(snapshot.bankCount).toBe(143);
      expect(snapshot.turnPlayerId).toBe(PLAYER_ID);
    });

    it("rejects a player who isn't up before the deadline", async () => {
      await seedTwoPlayerLobby();
      await startGame(redis, startGameCommand(), HOST_ID);

      const result = await turnTile(redis, turnTileCommand(), PLAYER_ID);

      expect(result).toEqual({ error: "NotYourTurn" });
    });

    it("lets another player force the turn once the current player has gone stale", async () => {
      await seedTwoPlayerLobby();
      await startGame(redis, startGameCommand(), HOST_ID);
      await makeHostStale(); // host-1 is the initial turnPlayerId

      const result = await turnTile(redis, turnTileCommand(), PLAYER_ID);

      expect(result).not.toHaveProperty("error");
      const { snapshot } = result as { snapshot: GameSnapshot };
      expect(snapshot.turnPlayerId).toBe(PLAYER_ID);
    });
  });

  describe("endGame", () => {
    // The deadline check/status transition itself (including its own
    // concurrent-race coverage) is tested at the packages/redis layer
    // (applyEndGame.test.ts) — this only covers the apps/server wrapper.

    it("returns GameNotFound for an unknown game", async () => {
      const result = await endGame(redis, endGameCommand());
      expect(result).toEqual({ error: "GameNotFound" });
    });

    it("returns GameNotStarted for a game still in the lobby", async () => {
      await seedTwoPlayerLobby();
      const result = await endGame(redis, endGameCommand());
      expect(result).toEqual({ error: "GameNotStarted" });
    });

    it("returns GameNotIdle before the idle deadline has passed", async () => {
      await seedPlayingState({ bankCount: 0, endGameDeadline: Date.now() + 60_000 });
      const result = await endGame(redis, endGameCommand());
      expect(result).toEqual({ error: "GameNotIdle" });
    });

    it("ends the game once the idle deadline has passed", async () => {
      await seedPlayingState({ bankCount: 0, endGameDeadline: Date.now() - 1 });

      const result = await endGame(redis, endGameCommand());

      expect(result).not.toHaveProperty("error");
      const { snapshot } = result as { snapshot: GameSnapshot };
      expect(snapshot.status).toBe("ended");
    });
  });

  describe("submitWord", () => {
    // The decomposition search itself (packages/game resolveWordPlay) and
    // the atomic re-verify/apply (packages/redis apply_submit_word.lua,
    // including its own concurrent-race coverage) are tested at their own
    // layers — this only covers the apps/server wrapper: loading state,
    // calling through, and turning the result into a GameSnapshot + the
    // narration fields the WordPlayed event needs.

    it("returns GameNotFound for an unknown game", async () => {
      const result = await submitWord(redis, submitWordCommand(), HOST_ID);
      expect(result).toEqual({ error: "GameNotFound" });
    });

    it("returns GameNotStarted for a game still in the lobby", async () => {
      await seedTwoPlayerLobby();
      const result = await submitWord(redis, submitWordCommand(), HOST_ID);
      expect(result).toEqual({ error: "GameNotStarted" });
    });

    it("returns PlayerNotFound for a player not in the game", async () => {
      await seedPlayingState();
      const result = await submitWord(redis, submitWordCommand(), "ghost");
      expect(result).toEqual({ error: "PlayerNotFound" });
    });

    it("returns NotAWord for something not in the dictionary when its letters are available", async () => {
      // packages/game's resolveWordPlay checks letters before the dictionary
      // (see docs/decisions.md "Letters checked before dictionary") — the
      // pool has to actually spell "zzzzx" for this to exercise NotAWord
      // rather than NoDecomposition.
      await seedPlayingState({ pool: ["Z", "Z", "Z", "Z", "X"] });
      const result = await submitWord(redis, submitWordCommand({ word: "zzzzx" }), HOST_ID);
      expect(result).toEqual({ error: "NotAWord" });
    });

    it("returns NoDecomposition when the letters aren't available", async () => {
      await seedPlayingState({ pool: ["C", "A"] }); // no "T"
      const result = await submitWord(redis, submitWordCommand({ word: "cat" }), HOST_ID);
      expect(result).toEqual({ error: "NoDecomposition" });
    });

    it("applies a pool-only play, stores it uppercase, and transfers the turn", async () => {
      await seedPlayingState({ pool: ["C", "A", "T"], turnPlayerId: "host-1" });

      const result = await submitWord(redis, submitWordCommand({ word: "cat" }), HOST_ID);

      expect(result).not.toHaveProperty("error");
      const success = result as Exclude<typeof result, { error: unknown }>;
      expect(success.word).toBe("CAT");
      expect(success.usedWords).toEqual([]);
      expect(success.usedPoolLetters).toEqual(["C", "A", "T"]);
      expect(success.snapshot.pool).toEqual([]);
      expect(success.snapshot.turnPlayerId).toBe("host-1");
      expect(success.snapshot.players[0]).toMatchObject({ id: "host-1", words: ["CAT"], score: 1 });
    });

    it("applies a steal and reports who it was taken from", async () => {
      await seedPlayingState({
        pool: ["C", "A", "T", "S"],
        players: [
          { id: "host-1", name: "Host", words: [], score: 0 },
          { id: "player-2", name: "Player Two", words: ["CAT"], score: 1 },
        ],
      });

      const result = await submitWord(redis, submitWordCommand({ word: "cast" }), HOST_ID);

      expect(result).not.toHaveProperty("error");
      const success = result as Exclude<typeof result, { error: unknown }>;
      expect(success.word).toBe("CAST");
      expect(success.usedWords).toEqual([{ word: "CAT", ownerId: "player-2" }]);
      expect(success.usedPoolLetters).toEqual(["S"]);
      expect(success.snapshot.players[0]).toMatchObject({ words: ["CAST"], score: 2 });
      expect(success.snapshot.players[1]).toMatchObject({ words: [], score: 0 });
      // Playing a word also becomes the submitter's tile-turn.
      expect(success.snapshot.turnPlayerId).toBe("host-1");
    });

    it("lets a different player independently claim a word already on the board", async () => {
      // Duplicate claims of the identical word are allowed as long as the
      // letters are genuinely available each time — see docs/decisions.md
      // "Duplicate word claims are allowed".
      await seedPlayingState({
        pool: ["C", "A", "T"],
        players: [
          { id: "host-1", name: "Host", words: ["CAT"], score: 1 },
          { id: "player-2", name: "Player Two", words: [], score: 0 },
        ],
      });
      const result = await submitWord(redis, submitWordCommand({ word: "cat" }), PLAYER_ID);

      expect(result).not.toHaveProperty("error");
      const success = result as Exclude<typeof result, { error: unknown }>;
      expect(success.snapshot.players[0]).toMatchObject({ words: ["CAT"], score: 1 });
      expect(success.snapshot.players[1]).toMatchObject({ words: ["CAT"], score: 1 });
    });
  });
});
