// Integration tests against a real Redis (not a mock) — see CLAUDE.md
// "Testing strategy", same rationale/harness as lobby.test.ts. The
// TurnTile-specific atomicity/race coverage lives in
// packages/redis/src/applyTurnTile.test.ts (the Lua script itself); this
// file covers the apps/server wrapper: command validation, error codes, and
// wiring the result back into a LobbySnapshot.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { createRedisClient, type Redis } from "@anagrabble/redis";
import type {
  CreateGameCommand,
  GameState,
  JoinGameCommand,
  LobbySnapshot,
  StartGameCommand,
  SubmitWordCommand,
  TurnTileCommand,
} from "@anagrabble/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGame, joinGame, stateKey } from "./lobby.js";
import { startGame, submitWord, turnTile } from "./game.js";

const CONFIG = { turnTimerSec: 30, minWordLength: 3, language: "en" };

function createGameCommand(overrides: Partial<CreateGameCommand> = {}): CreateGameCommand {
  return {
    type: "CreateGame",
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    hostId: "host-1",
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
    playerId: "player-2",
    playerName: "Player Two",
    ...overrides,
  };
}

function startGameCommand(overrides: Partial<StartGameCommand> = {}): StartGameCommand {
  return {
    type: "StartGame",
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    hostId: "host-1",
    ...overrides,
  };
}

function turnTileCommand(overrides: Partial<TurnTileCommand> = {}): TurnTileCommand {
  return {
    type: "TurnTile",
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    playerId: "host-1",
    ...overrides,
  };
}

function submitWordCommand(overrides: Partial<SubmitWordCommand> = {}): SubmitWordCommand {
  return {
    type: "SubmitWord",
    commandId: crypto.randomUUID(),
    gameId: "game-1",
    playerId: "host-1",
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
  }, 60_000);

  afterAll(async () => {
    redis.disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  async function seedTwoPlayerLobby() {
    await createGame(redis, createGameCommand());
    await joinGame(redis, joinGameCommand());
  }

  /** A deterministic `playing` state (pool/claimed words as given), bypassing
   * startGame's random bag shuffle — submitWord tests need to control
   * exactly what's on the board, not just that a game has started. */
  async function seedPlayingState(overrides: Partial<GameState> = {}) {
    const state: GameState = {
      status: "playing",
      seq: 0,
      config: CONFIG,
      turnPlayerIndex: 0,
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
      const result = await startGame(redis, startGameCommand());
      expect(result).toEqual({ error: "GameNotFound" });
    });

    it("rejects a non-host caller", async () => {
      await seedTwoPlayerLobby();
      const result = await startGame(redis, startGameCommand({ hostId: "player-2" }));
      expect(result).toEqual({ error: "NotHost" });
    });

    it("rejects starting with fewer than two players", async () => {
      await createGame(redis, createGameCommand());
      const result = await startGame(redis, startGameCommand());
      expect(result).toEqual({ error: "NotEnoughPlayers" });
    });

    it("rejects starting a game that's already playing", async () => {
      await seedTwoPlayerLobby();
      await startGame(redis, startGameCommand());
      const result = await startGame(redis, startGameCommand({ commandId: crypto.randomUUID() }));
      expect(result).toEqual({ error: "GameAlreadyStarted" });
    });

    it("shuffles a full bag and opens the first turn", async () => {
      await seedTwoPlayerLobby();
      const before = Date.now();

      const result = await startGame(redis, startGameCommand());

      expect(result).not.toHaveProperty("error");
      const { snapshot } = result as { snapshot: LobbySnapshot };
      expect(snapshot.status).toBe("playing");
      expect(snapshot.turnPlayerIndex).toBe(0);
      expect(snapshot.bankCount).toBe(144);
      expect(snapshot.pool).toEqual([]);
      expect(snapshot.turnDeadline).not.toBeNull();
      expect(snapshot.turnDeadline!).toBeGreaterThanOrEqual(before + CONFIG.turnTimerSec * 1000);

      const bagLength = await redis.llen("game:{game-1}:bag");
      expect(bagLength).toBe(144);
    });

    it("is idempotent when retried with the same commandId", async () => {
      await seedTwoPlayerLobby();
      const cmd = startGameCommand();

      const first = await startGame(redis, cmd);
      const second = await startGame(redis, cmd);

      expect(second).toEqual(first);
      const bagLength = await redis.llen("game:{game-1}:bag");
      expect(bagLength).toBe(144);
    });
  });

  describe("turnTile", () => {
    it("returns GameNotStarted for a game still in the lobby", async () => {
      await seedTwoPlayerLobby();
      const result = await turnTile(redis, turnTileCommand());
      expect(result).toEqual({ error: "GameNotStarted" });
    });

    it("lets the current player turn a tile", async () => {
      await seedTwoPlayerLobby();
      await startGame(redis, startGameCommand());

      const result = await turnTile(redis, turnTileCommand({ playerId: "host-1" }));

      expect(result).not.toHaveProperty("error");
      const { snapshot } = result as { snapshot: LobbySnapshot };
      expect(snapshot.pool).toHaveLength(1);
      expect(snapshot.bankCount).toBe(143);
      expect(snapshot.turnPlayerIndex).toBe(1);
    });

    it("rejects a player who isn't up before the deadline", async () => {
      await seedTwoPlayerLobby();
      await startGame(redis, startGameCommand());

      const result = await turnTile(redis, turnTileCommand({ playerId: "player-2" }));

      expect(result).toEqual({ error: "NotYourTurn" });
    });
  });

  describe("submitWord", () => {
    // The decomposition search itself (packages/game resolveWordPlay) and
    // the atomic re-verify/apply (packages/redis apply_submit_word.lua,
    // including its own concurrent-race coverage) are tested at their own
    // layers — this only covers the apps/server wrapper: loading state,
    // calling through, and turning the result into a LobbySnapshot + the
    // narration fields the WordPlayed event needs.

    it("returns GameNotFound for an unknown game", async () => {
      const result = await submitWord(redis, submitWordCommand());
      expect(result).toEqual({ error: "GameNotFound" });
    });

    it("returns GameNotStarted for a game still in the lobby", async () => {
      await seedTwoPlayerLobby();
      const result = await submitWord(redis, submitWordCommand());
      expect(result).toEqual({ error: "GameNotStarted" });
    });

    it("returns PlayerNotFound for a player not in the game", async () => {
      await seedPlayingState();
      const result = await submitWord(redis, submitWordCommand({ playerId: "ghost" }));
      expect(result).toEqual({ error: "PlayerNotFound" });
    });

    it("returns NotAWord for something not in the dictionary", async () => {
      await seedPlayingState();
      const result = await submitWord(redis, submitWordCommand({ word: "zzzzx" }));
      expect(result).toEqual({ error: "NotAWord" });
    });

    it("returns NoDecomposition when the letters aren't available", async () => {
      await seedPlayingState({ pool: ["C", "A"] }); // no "T"
      const result = await submitWord(redis, submitWordCommand({ word: "cat" }));
      expect(result).toEqual({ error: "NoDecomposition" });
    });

    it("applies a pool-only play, stores it uppercase, and transfers the turn", async () => {
      await seedPlayingState({ pool: ["C", "A", "T"], turnPlayerIndex: 0 });

      const result = await submitWord(
        redis,
        submitWordCommand({ playerId: "host-1", word: "cat" }),
      );

      expect(result).not.toHaveProperty("error");
      const success = result as Exclude<typeof result, { error: unknown }>;
      expect(success.word).toBe("CAT");
      expect(success.usedWords).toEqual([]);
      expect(success.usedPoolLetters).toEqual(["C", "A", "T"]);
      expect(success.snapshot.pool).toEqual([]);
      expect(success.snapshot.turnPlayerIndex).toBe(0);
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

      const result = await submitWord(
        redis,
        submitWordCommand({ playerId: "host-1", word: "cast" }),
      );

      expect(result).not.toHaveProperty("error");
      const success = result as Exclude<typeof result, { error: unknown }>;
      expect(success.word).toBe("CAST");
      expect(success.usedWords).toEqual([{ word: "CAT", ownerId: "player-2" }]);
      expect(success.usedPoolLetters).toEqual(["S"]);
      expect(success.snapshot.players[0]).toMatchObject({ words: ["CAST"], score: 2 });
      expect(success.snapshot.players[1]).toMatchObject({ words: [], score: 0 });
      // Playing a word also becomes the submitter's tile-turn.
      expect(success.snapshot.turnPlayerIndex).toBe(0);
    });

    it("returns WordAlreadyClaimed when the word is already on the board", async () => {
      await seedPlayingState({
        players: [
          { id: "host-1", name: "Host", words: ["CAT"], score: 1 },
          { id: "player-2", name: "Player Two", words: [], score: 0 },
        ],
      });
      const result = await submitWord(
        redis,
        submitWordCommand({ playerId: "player-2", word: "cat" }),
      );
      expect(result).toEqual({ error: "WordAlreadyClaimed" });
    });
  });
});
