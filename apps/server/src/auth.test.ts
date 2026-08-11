// Unit tests, not integration — verifySessionToken is a thin wrapper around
// @clerk/backend's verifyToken, so the network/JWKS behavior is Clerk's to
// test. What's ours to verify is the mapping: valid token -> userId, and
// every failure mode (bad signature, expired, network error) collapses to
// `null` rather than throwing, since a connecting socket shouldn't be able
// to crash the server with a malformed token.
//
// @clerk/backend's root-level `verifyToken` export is the "legacy" style:
// resolves with the JWT payload directly and *throws* on an invalid token
// (see node_modules/@clerk/backend/dist/index.js's `withLegacyReturn`
// wrapper) — not the `{ data, errors }` result object its own tokens/verify
// doc comment describes; that shape belongs to a lower-level internal
// function this package doesn't expose at the top level.

import { describe, expect, it, vi } from "vitest";

const verifyToken = vi.fn();
vi.mock("@clerk/backend", () => ({ verifyToken: (...args: unknown[]) => verifyToken(...args) }));

const { resolveActingPlayerId, verifyMockSessionToken, verifySessionToken } =
  await import("./auth.js");

describe("verifySessionToken", () => {
  it("returns the Clerk user id for a valid token", async () => {
    verifyToken.mockResolvedValue({ sub: "user_123" });

    const result = await verifySessionToken("a-valid-token", "sk_test_secret");

    expect(result).toEqual({ userId: "user_123" });
    expect(verifyToken).toHaveBeenCalledWith("a-valid-token", { secretKey: "sk_test_secret" });
  });

  it("returns null rather than throwing when the token is invalid/expired", async () => {
    verifyToken.mockRejectedValue(new Error("expired"));

    const result = await verifySessionToken("an-expired-token", "sk_test_secret");

    expect(result).toBeNull();
  });

  it("returns null rather than throwing on a JWKS network failure", async () => {
    verifyToken.mockRejectedValue(new Error("network error fetching JWKS"));

    const result = await verifySessionToken("some-token", "sk_test_secret");

    expect(result).toBeNull();
  });
});

describe("verifyMockSessionToken", () => {
  it("trusts a non-empty token as the user id directly, no verification", () => {
    const callsBefore = verifyToken.mock.calls.length;
    expect(verifyMockSessionToken("mock-alice")).toEqual({ userId: "mock-alice" });
    expect(verifyToken.mock.calls.length).toBe(callsBefore);
  });

  it("returns null for an empty token", () => {
    expect(verifyMockSessionToken("")).toBeNull();
  });
});

describe("resolveActingPlayerId", () => {
  it("returns the verified Clerk id when one is present", () => {
    expect(resolveActingPlayerId({ clerkUserId: "user_123" })).toBe("user_123");
  });

  it("returns null when the connection has no verified identity", () => {
    expect(resolveActingPlayerId({})).toBeNull();
  });
});
