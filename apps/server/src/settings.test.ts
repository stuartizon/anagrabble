// Unit tests, not integration — handleGetSettingsRequest/
// handleSaveSettingsRequest are thin auth/validation/dispatch wrappers
// around getPlayerSettings/upsertPlayerSettings, so query correctness is
// packages/postgres/src/settings.test.ts's job (real Postgres via
// testcontainers). What's ours to verify here is auth/validation/
// status-code/response-shape wiring, same split as stats.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Kysely, PlayerSettings } from "@anagrabble/postgres";

beforeEach(() => {
  vi.clearAllMocks();
});

const verifySessionToken = vi.fn();
vi.mock("./auth.js", () => ({
  verifySessionToken: (...args: unknown[]) => verifySessionToken(...args),
}));

const getPlayerSettings = vi.fn();
const upsertPlayerSettings = vi.fn();
vi.mock("@anagrabble/postgres", () => ({
  getPlayerSettings: (...args: unknown[]) => getPlayerSettings(...args),
  upsertPlayerSettings: (...args: unknown[]) => upsertPlayerSettings(...args),
}));

const { handleGetSettingsRequest, handleSaveSettingsRequest } = await import("./settings.js");

// getPlayerSettings/upsertPlayerSettings are mocked above — the real Kysely
// instance is never touched.
const FAKE_DB = {} as Kysely<Database>;

const SAMPLE_SETTINGS: PlayerSettings = {
  language: "English",
  soundEnabled: false,
  hapticsEnabled: true,
};

describe("handleGetSettingsRequest", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const result = await handleGetSettingsRequest(FAKE_DB, "sk_test", undefined);

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(verifySessionToken).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header isn't a Bearer token", async () => {
    const result = await handleGetSettingsRequest(FAKE_DB, "sk_test", "not-a-bearer-token");

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(verifySessionToken).not.toHaveBeenCalled();
  });

  it("returns 401 when the token fails to verify", async () => {
    verifySessionToken.mockResolvedValue(null);

    const result = await handleGetSettingsRequest(FAKE_DB, "sk_test", "Bearer bad-token");

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
  });

  it("returns 200 with the player's settings for a valid token", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    getPlayerSettings.mockResolvedValue(SAMPLE_SETTINGS);

    const result = await handleGetSettingsRequest(FAKE_DB, "sk_test", "Bearer good-token");

    expect(verifySessionToken).toHaveBeenCalledWith("good-token", "sk_test");
    expect(getPlayerSettings).toHaveBeenCalledWith(FAKE_DB, "user_1");
    expect(result).toEqual({ status: 200, body: SAMPLE_SETTINGS });
  });

  it("returns 500 and logs when getPlayerSettings rejects", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    getPlayerSettings.mockRejectedValue(new Error("db exploded"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await handleGetSettingsRequest(FAKE_DB, "sk_test", "Bearer good-token");

    expect(result).toEqual({ status: 500, body: { error: "Internal error" } });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe("handleSaveSettingsRequest", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const result = await handleSaveSettingsRequest(FAKE_DB, "sk_test", undefined, SAMPLE_SETTINGS);

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(upsertPlayerSettings).not.toHaveBeenCalled();
  });

  it("returns 401 when the token fails to verify", async () => {
    verifySessionToken.mockResolvedValue(null);

    const result = await handleSaveSettingsRequest(
      FAKE_DB,
      "sk_test",
      "Bearer bad-token",
      SAMPLE_SETTINGS,
    );

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(upsertPlayerSettings).not.toHaveBeenCalled();
  });

  it("saves and returns 200 with the saved settings for a valid body", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });

    const result = await handleSaveSettingsRequest(
      FAKE_DB,
      "sk_test",
      "Bearer good-token",
      SAMPLE_SETTINGS,
    );

    expect(upsertPlayerSettings).toHaveBeenCalledWith(FAKE_DB, "user_1", SAMPLE_SETTINGS);
    expect(result).toEqual({ status: 200, body: SAMPLE_SETTINGS });
  });

  it.each([
    ["a non-English language", { ...SAMPLE_SETTINGS, language: "Spanish" }],
    ["a missing language", { ...SAMPLE_SETTINGS, language: undefined }],
    ["a non-boolean soundEnabled", { ...SAMPLE_SETTINGS, soundEnabled: "yes" }],
    ["a non-boolean hapticsEnabled", { ...SAMPLE_SETTINGS, hapticsEnabled: 1 }],
    ["a non-object body", "not-an-object"],
    ["a null body", null],
  ])("returns 400 without saving for %s", async (_label, body) => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });

    const result = await handleSaveSettingsRequest(FAKE_DB, "sk_test", "Bearer good-token", body);

    expect(result).toEqual({ status: 400, body: { error: "Invalid settings" } });
    expect(upsertPlayerSettings).not.toHaveBeenCalled();
  });

  it("returns 500 and logs when upsertPlayerSettings rejects", async () => {
    verifySessionToken.mockResolvedValue({ userId: "user_1" });
    upsertPlayerSettings.mockRejectedValue(new Error("db exploded"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await handleSaveSettingsRequest(
      FAKE_DB,
      "sk_test",
      "Bearer good-token",
      SAMPLE_SETTINGS,
    );

    expect(result).toEqual({ status: 500, body: { error: "Internal error" } });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
