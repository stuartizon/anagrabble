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
  JoinGameCommand,
  LobbySnapshot,
  StartGameCommand,
  TurnTileCommand,
} from "@anagrabble/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGame, joinGame } from "./lobby.js";
import { startGame, turnTile } from "./game.js";

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
});
