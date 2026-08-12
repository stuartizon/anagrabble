// Integration tests against a real Redis (not a mock) — see CLAUDE.md
// "Testing strategy". lobby.ts is real, deployed logic (the lobby vertical
// slice), so this exercises actual behavior: idempotency dedup, seq
// increments, and the documented state-machine transitions, against the
// same redis:7-alpine image infrastructure/docker-compose.yml uses.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { createRedisClient, type Redis } from "@anagrabble/redis";
import type {
  CreateGameCommand,
  GameState,
  JoinGameCommand,
  LobbySnapshot,
} from "@anagrabble/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGame, joinGame, leaveGame } from "./lobby.js";

const CONFIG = { turnTimerSec: 30, minWordLength: 3, language: "en" };
const HOST_ID = "host-1";
const PLAYER_ID = "player-2";

function createGameCommand(overrides: Partial<CreateGameCommand> = {}): CreateGameCommand {
  return {
    type: "CreateGame",
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

describe("lobby", () => {
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

  describe("createGame", () => {
    it("creates a lobby with the host as the sole player", async () => {
      const result = await createGame(redis, createGameCommand(), HOST_ID);

      expect(result).not.toHaveProperty("error");
      const { snapshot } = result as { snapshot: LobbySnapshot };
      expect(snapshot.status).toBe("lobby");
      expect(snapshot.hostId).toBe("host-1");
      expect(snapshot.players).toEqual([expect.objectContaining({ id: "host-1", name: "Host" })]);
    });

    it("is idempotent when retried with the same commandId", async () => {
      const cmd = createGameCommand();
      const first = await createGame(redis, cmd, HOST_ID);
      const second = await createGame(redis, cmd, HOST_ID);

      expect(second).toEqual(first);
    });

    it("rejects a different commandId reusing an existing gameId", async () => {
      await createGame(redis, createGameCommand(), HOST_ID);
      const result = await createGame(
        redis,
        createGameCommand({ commandId: crypto.randomUUID() }),
        HOST_ID,
      );

      expect(result).toEqual({ error: "GameIdTaken" });
    });
  });

  describe("joinGame", () => {
    it("returns GameNotFound for an unknown game", async () => {
      const result = await joinGame(redis, joinGameCommand(), PLAYER_ID);

      expect(result).toEqual({ error: "GameNotFound" });
    });

    it("adds the player and bumps seq", async () => {
      await createGame(redis, createGameCommand(), HOST_ID);
      const result = await joinGame(redis, joinGameCommand(), PLAYER_ID);

      expect(result).toMatchObject({
        isNew: true,
        player: { id: "player-2", name: "Player Two" },
      });
      const { snapshot } = result as { snapshot: LobbySnapshot };
      expect(snapshot.players.map((p) => p.id)).toEqual(["host-1", "player-2"]);
      expect(snapshot.seq).toBe(1);
    });

    it("is idempotent when retried with the same commandId, without duplicating the player", async () => {
      await createGame(redis, createGameCommand(), HOST_ID);
      const cmd = joinGameCommand();
      await joinGame(redis, cmd, PLAYER_ID);
      const result = await joinGame(redis, cmd, PLAYER_ID);

      expect(result).toMatchObject({ isNew: false });
      const { snapshot } = result as { snapshot: LobbySnapshot };
      expect(snapshot.players).toHaveLength(2);
    });

    it("allows joining mid-game, appended to the end of players", async () => {
      await createGame(redis, createGameCommand(), HOST_ID);
      await seedGameState(redis, "game-1", (state) => ({ ...state, status: "playing" }));

      const result = await joinGame(redis, joinGameCommand(), PLAYER_ID);

      expect(result).toMatchObject({
        isNew: true,
        player: { id: "player-2", name: "Player Two", score: 0, words: [] },
      });
      const { snapshot } = result as { snapshot: LobbySnapshot };
      expect(snapshot.players.map((p) => p.id)).toEqual(["host-1", "player-2"]);
    });

    it("rejects joining a game that has already ended", async () => {
      await createGame(redis, createGameCommand(), HOST_ID);
      await seedGameState(redis, "game-1", (state) => ({ ...state, status: "ended" }));

      const result = await joinGame(redis, joinGameCommand(), PLAYER_ID);

      expect(result).toEqual({ error: "GameAlreadyEnded" });
    });
  });

  describe("leaveGame", () => {
    it("removes the player and bumps seq", async () => {
      await createGame(redis, createGameCommand(), HOST_ID);
      await joinGame(redis, joinGameCommand(), PLAYER_ID);

      const snapshot = await leaveGame(redis, "game-1", "player-2");

      expect(snapshot?.players.map((p) => p.id)).toEqual(["host-1"]);
      expect(snapshot?.seq).toBe(2);
    });

    it("is a no-op for a player who isn't in the lobby", async () => {
      await createGame(redis, createGameCommand(), HOST_ID);

      const snapshot = await leaveGame(redis, "game-1", "nobody");

      expect(snapshot).toBeNull();
    });

    it("is a no-op once the game has started", async () => {
      await createGame(redis, createGameCommand(), HOST_ID);
      await joinGame(redis, joinGameCommand(), PLAYER_ID);
      await seedGameState(redis, "game-1", (state) => ({ ...state, status: "playing" }));

      const snapshot = await leaveGame(redis, "game-1", "player-2");

      expect(snapshot).toBeNull();
    });
  });
});

// Writes directly to the documented state key (docs/redis-schema.md) to set
// up preconditions no public command can reach yet (no StartGame command
// exists until real gameplay lands).
async function seedGameState(
  redis: Redis,
  gameId: string,
  transform: (state: GameState) => GameState,
): Promise<void> {
  const raw = await redis.get(`game:{${gameId}}:state`);
  if (!raw) throw new Error(`no state seeded for ${gameId}`);
  await redis.set(
    `game:{${gameId}}:state`,
    JSON.stringify(transform(JSON.parse(raw) as GameState)),
  );
}
