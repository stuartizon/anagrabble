// Unit tests, not integration — handleCreateGameRequest is a thin
// auth/validation/dispatch wrapper around gameSession.ts's createGame(), so
// Redis mutation correctness (idempotency dedup, seq, state shape) is
// gameSession.test.ts's job (real Redis via testcontainers). What's ours to
// verify here is auth/validation/status-code/response-shape wiring, same
// split as stats.test.ts/settings.test.ts — plus the gameId-generation/
// collision-retry loop, which is genuinely new logic this file owns (see
// docs/decisions.md "CreateGame as a REST endpoint").

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "@anagrabble/redis";
import type { Database, Kysely } from "@anagrabble/postgres";
import type { CreateGameRequest, GameSnapshot } from "@anagrabble/protocol";

beforeEach(() => {
  vi.clearAllMocks();
});

const verifySessionToken = vi.fn();
const verifyMockSessionToken = vi.fn();
vi.mock("./auth.js", () => ({
  verifySessionToken: (...args: unknown[]) => verifySessionToken(...args),
  verifyMockSessionToken: (...args: unknown[]) => verifyMockSessionToken(...args),
}));

const observability = vi.hoisted(() => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));
vi.mock("./observability.js", () => observability);

const createGame = vi.fn();
const leaveGame = vi.fn();
const loadGameState = vi.fn();
const toGameSnapshot = vi.fn();
vi.mock("./gameSession.js", () => ({
  createGame: (...args: unknown[]) => createGame(...args),
  leaveGame: (...args: unknown[]) => leaveGame(...args),
  loadGameState: (...args: unknown[]) => loadGameState(...args),
  toGameSnapshot: (...args: unknown[]) => toGameSnapshot(...args),
}));

const gameIdExists = vi.fn<(db: unknown, gameId: string) => Promise<boolean>>(async () => false);
vi.mock("@anagrabble/postgres", () => ({
  gameIdExists: (db: unknown, gameId: string) => gameIdExists(db, gameId),
}));

const { handleCreateGameRequest, handleLeaveGameRequest } = await import("./games.js");

// createGame/gameIdExists are mocked above — neither real client is touched.
const FAKE_REDIS = {} as Redis;
const FAKE_DB = {} as Kysely<Database>;

const VALID_BODY: CreateGameRequest = {
  hostName: "Alice",
  config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
};

function sampleSnapshot(gameId: string): GameSnapshot {
  return {
    gameId,
    hostId: "user_1",
    status: "lobby",
    seq: 0,
    config: VALID_BODY.config,
    turnPlayerId: "user_1",
    turnDeadline: null,
    endGameDeadline: null,
    bankCount: 0,
    pool: [],
    players: [{ id: "user_1", name: "Alice", words: [], score: 0 }],
  };
}

describe("handleCreateGameRequest", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      undefined,
      VALID_BODY,
    );

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(createGame).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header isn't a Bearer token", async () => {
    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "not-a-bearer-token",
      VALID_BODY,
    );

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(createGame).not.toHaveBeenCalled();
  });

  it("returns 401 when the token fails to verify", async () => {
    verifySessionToken.mockResolvedValue(null);

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "Bearer bad-token",
      VALID_BODY,
    );

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(createGame).not.toHaveBeenCalled();
  });

  it("verifies via the mock auth path when authMode is 'mock'", async () => {
    verifyMockSessionToken.mockReturnValue({ userId: "user_1" });
    createGame.mockImplementation(async (_redis, cmd) => ({
      snapshot: sampleSnapshot(cmd.gameId),
    }));

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "Bearer mock-user_1",
      VALID_BODY,
      "mock",
    );

    expect(verifyMockSessionToken).toHaveBeenCalledWith("mock-user_1");
    expect(verifySessionToken).not.toHaveBeenCalled();
    expect(result?.status).toBe(201);
  });

  it.each([
    ["a missing hostName", { ...VALID_BODY, hostName: undefined }],
    ["a missing config", { ...VALID_BODY, config: undefined }],
    [
      "a non-numeric turnTimerSec",
      { ...VALID_BODY, config: { ...VALID_BODY.config, turnTimerSec: "30" } },
    ],
    [
      "a non-numeric minWordLength",
      { ...VALID_BODY, config: { ...VALID_BODY.config, minWordLength: "3" } },
    ],
    ["a non-string language", { ...VALID_BODY, config: { ...VALID_BODY.config, language: 1 } }],
    ["a non-object body", "not-an-object"],
    ["a null body", null],
  ])("returns 400 without creating a game for %s", async (_label, body) => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "Bearer good-token",
      body,
    );

    expect(result).toEqual({ status: 400, body: { error: "Invalid request" } });
    expect(createGame).not.toHaveBeenCalled();
  });

  it("generates a gameId and commandId server-side and returns 201 with the resulting snapshot", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    createGame.mockImplementation(async (_redis, cmd) => ({
      snapshot: sampleSnapshot(cmd.gameId),
    }));

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "Bearer good-token",
      VALID_BODY,
    );

    expect(verifySessionToken).toHaveBeenCalledWith("good-token", "sk_test");
    expect(createGame).toHaveBeenCalledTimes(1);
    expect(createGame).toHaveBeenCalledWith(
      FAKE_REDIS,
      {
        commandId: expect.any(String),
        gameId: expect.stringMatching(/^[A-Z0-9]{5}$/),
        hostName: VALID_BODY.hostName,
        config: VALID_BODY.config,
      },
      "user_1",
    );
    expect(createGame.mock.calls[0]![1].commandId).toBeTruthy();
    expect(result.status).toBe(201);
    expect((result.body as GameSnapshot).gameId).toMatch(/^[A-Z0-9]{5}$/);
  });

  it("retries with a freshly generated gameId when the first choice collides, and succeeds", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    createGame
      .mockResolvedValueOnce({ error: "GameIdTaken" })
      .mockImplementationOnce(async (_redis, cmd) => ({ snapshot: sampleSnapshot(cmd.gameId) }));

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "Bearer good-token",
      VALID_BODY,
    );

    expect(createGame).toHaveBeenCalledTimes(2);
    const firstAttemptGameId: string = createGame.mock.calls[0]![1].gameId;
    const secondAttemptGameId: string = createGame.mock.calls[1]![1].gameId;
    expect(secondAttemptGameId).not.toBe(firstAttemptGameId);
    expect(result).toEqual({ status: 201, body: sampleSnapshot(secondAttemptGameId) });
  });

  it("skips a gameId a started game has already used in Postgres, even though Redis no longer has it (anagrabble#58)", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    gameIdExists.mockResolvedValueOnce(true);
    createGame.mockImplementation(async (_redis, cmd) => ({
      snapshot: sampleSnapshot(cmd.gameId),
    }));

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "Bearer good-token",
      VALID_BODY,
    );

    expect(gameIdExists).toHaveBeenCalledTimes(2);
    const usedGameId = gameIdExists.mock.calls[0]![1];
    expect(createGame).toHaveBeenCalledTimes(1);
    expect(createGame.mock.calls[0]![1].gameId).not.toBe(usedGameId);
    expect(result.status).toBe(201);
  });

  it("still creates the game, and reports, when the Postgres check fails", async () => {
    // Fail open: a Postgres outage shouldn't block starting a game, and the
    // game's history couldn't be written during one anyway.
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    gameIdExists.mockRejectedValueOnce(new Error("postgres unreachable"));
    createGame.mockImplementation(async (_redis, cmd) => ({
      snapshot: sampleSnapshot(cmd.gameId),
    }));

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "Bearer good-token",
      VALID_BODY,
    );

    expect(result.status).toBe(201);
    expect(observability.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ op: "http.createGame.checkId" }) }),
    );
  });

  it("gives up, returns 500, and reports after repeated gameId collisions", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    createGame.mockResolvedValue({ error: "GameIdTaken" });

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "Bearer good-token",
      VALID_BODY,
    );

    expect(createGame.mock.calls.length).toBeGreaterThan(1);
    expect(result).toEqual({ status: 500, body: { error: "Internal error" } });
    // A warning rather than an exception: nothing threw, but exhausting the
    // id space shouldn't be reachable in normal operation (anagrabble#46).
    expect(observability.reportWarning).toHaveBeenCalled();
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("returns 500 and reports when createGame rejects", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    createGame.mockRejectedValue(new Error("redis exploded"));

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      FAKE_DB,
      "sk_test",
      "Bearer good-token",
      VALID_BODY,
    );

    expect(result).toEqual({ status: 500, body: { error: "Internal error" } });
    expect(observability.reportError).toHaveBeenCalled();
  });
});

describe("handleLeaveGameRequest", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const result = await handleLeaveGameRequest(FAKE_REDIS, "sk_test", undefined, "GAME1");

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(loadGameState).not.toHaveBeenCalled();
  });

  it("returns 404 when the game doesn't exist", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    loadGameState.mockResolvedValue(null);

    const result = await handleLeaveGameRequest(
      FAKE_REDIS,
      "sk_test",
      "Bearer good-token",
      "GAME1",
    );

    expect(result).toEqual({ status: 404, body: { error: "GameNotFound" } });
    expect(leaveGame).not.toHaveBeenCalled();
  });

  it("removes the player and returns the new snapshot on success", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    loadGameState.mockResolvedValue(sampleSnapshot("GAME1"));
    const afterLeave = { ...sampleSnapshot("GAME1"), players: [] };
    leaveGame.mockResolvedValue(afterLeave);

    const result = await handleLeaveGameRequest(
      FAKE_REDIS,
      "sk_test",
      "Bearer good-token",
      "GAME1",
    );

    expect(leaveGame).toHaveBeenCalledWith(FAKE_REDIS, "GAME1", "user_1");
    expect(result).toEqual({ status: 200, body: afterLeave, playerId: "user_1", removed: true });
  });

  it("no-ops (removed: false) with the current snapshot once the game has started", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    const before = sampleSnapshot("GAME1");
    loadGameState.mockResolvedValue(before);
    leaveGame.mockResolvedValue(null);
    toGameSnapshot.mockReturnValue(before);

    const result = await handleLeaveGameRequest(
      FAKE_REDIS,
      "sk_test",
      "Bearer good-token",
      "GAME1",
    );

    expect(result).toEqual({ status: 200, body: before, playerId: "user_1", removed: false });
  });
});
