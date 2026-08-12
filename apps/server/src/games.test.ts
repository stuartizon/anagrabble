// Unit tests, not integration — handleCreateGameRequest is a thin
// auth/validation/dispatch wrapper around lobby.ts's createGame(), so
// Redis mutation correctness (idempotency dedup, seq, state shape) is
// lobby.test.ts's job (real Redis via testcontainers). What's ours to
// verify here is auth/validation/status-code/response-shape wiring, same
// split as stats.test.ts/settings.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "@anagrabble/redis";
import type { CreateGameRequest, LobbySnapshot } from "@anagrabble/protocol";

beforeEach(() => {
  vi.clearAllMocks();
});

const verifySessionToken = vi.fn();
const verifyMockSessionToken = vi.fn();
vi.mock("./auth.js", () => ({
  verifySessionToken: (...args: unknown[]) => verifySessionToken(...args),
  verifyMockSessionToken: (...args: unknown[]) => verifyMockSessionToken(...args),
}));

const createGame = vi.fn();
vi.mock("./lobby.js", () => ({
  createGame: (...args: unknown[]) => createGame(...args),
}));

const { handleCreateGameRequest } = await import("./games.js");

// createGame is mocked above — the real Redis client is never touched.
const FAKE_REDIS = {} as Redis;

const VALID_BODY: CreateGameRequest = {
  commandId: "cmd-1",
  gameId: "ABCDE",
  hostName: "Alice",
  config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
};

const SAMPLE_SNAPSHOT: LobbySnapshot = {
  gameId: "ABCDE",
  hostId: "user_1",
  status: "lobby",
  seq: 0,
  config: VALID_BODY.config,
  turnPlayerIndex: 0,
  turnDeadline: null,
  endGameDeadline: null,
  bankCount: 0,
  pool: [],
  players: [{ id: "user_1", name: "Alice", words: [], score: 0 }],
};

describe("handleCreateGameRequest", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const result = await handleCreateGameRequest(FAKE_REDIS, "sk_test", undefined, VALID_BODY);

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(createGame).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header isn't a Bearer token", async () => {
    const result = await handleCreateGameRequest(
      FAKE_REDIS,
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
      "sk_test",
      "Bearer bad-token",
      VALID_BODY,
    );

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(createGame).not.toHaveBeenCalled();
  });

  it("verifies via the mock auth path when authMode is 'mock'", async () => {
    verifyMockSessionToken.mockReturnValue({ userId: "user_1" });
    createGame.mockResolvedValue({ snapshot: SAMPLE_SNAPSHOT });

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      "sk_test",
      "Bearer mock-user_1",
      VALID_BODY,
      "mock",
    );

    expect(verifyMockSessionToken).toHaveBeenCalledWith("mock-user_1");
    expect(verifySessionToken).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 201, body: SAMPLE_SNAPSHOT });
  });

  it.each([
    ["a missing commandId", { ...VALID_BODY, commandId: undefined }],
    ["a non-string commandId", { ...VALID_BODY, commandId: 123 }],
    ["a missing gameId", { ...VALID_BODY, gameId: undefined }],
    ["an empty gameId", { ...VALID_BODY, gameId: "" }],
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

    const result = await handleCreateGameRequest(FAKE_REDIS, "sk_test", "Bearer good-token", body);

    expect(result).toEqual({ status: 400, body: { error: "Invalid request" } });
    expect(createGame).not.toHaveBeenCalled();
  });

  it("creates the game and returns 201 with the resulting snapshot for a valid request", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    createGame.mockResolvedValue({ snapshot: SAMPLE_SNAPSHOT });

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      "sk_test",
      "Bearer good-token",
      VALID_BODY,
    );

    expect(verifySessionToken).toHaveBeenCalledWith("good-token", "sk_test");
    expect(createGame).toHaveBeenCalledWith(
      FAKE_REDIS,
      {
        type: "CreateGame",
        commandId: VALID_BODY.commandId,
        gameId: VALID_BODY.gameId,
        hostName: VALID_BODY.hostName,
        config: VALID_BODY.config,
      },
      "user_1",
    );
    expect(result).toEqual({ status: 201, body: SAMPLE_SNAPSHOT });
  });

  it("returns 409 when the gameId is already taken", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    createGame.mockResolvedValue({ error: "GameIdTaken" });

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      "sk_test",
      "Bearer good-token",
      VALID_BODY,
    );

    expect(result).toEqual({ status: 409, body: { error: "GameIdTaken" } });
  });

  it("returns 500 and logs when createGame rejects", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    createGame.mockRejectedValue(new Error("redis exploded"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await handleCreateGameRequest(
      FAKE_REDIS,
      "sk_test",
      "Bearer good-token",
      VALID_BODY,
    );

    expect(result).toEqual({ status: 500, body: { error: "Internal error" } });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
