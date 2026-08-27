// TDD for the per-connection WS gameplay rate limiter — see CLAUDE.md
// "Game rules" -> "Word submission/stealing is free-for-all" and
// anagrabble#45. Pure logic, no I/O, so no testcontainers needed here (see
// server.test.ts for the WS/REST round-trip assertions this backs).

import { describe, expect, it } from "vitest";
import { TokenBucket } from "./rateLimiter.js";

describe("TokenBucket", () => {
  it("allows consuming up to its capacity in a burst", () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 1 });
    for (let i = 0; i < 5; i++) {
      expect(bucket.tryConsume(0)).toBe(true);
    }
  });

  it("rejects a consume once capacity is exhausted", () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 1 });
    for (let i = 0; i < 5; i++) bucket.tryConsume(0);
    expect(bucket.tryConsume(0)).toBe(false);
  });

  it("refills over time at refillPerSec, capped at capacity", () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 1 });
    for (let i = 0; i < 5; i++) bucket.tryConsume(0);
    expect(bucket.tryConsume(500)).toBe(false); // 0.5s elapsed -> 0.5 tokens, not enough
    expect(bucket.tryConsume(1_000)).toBe(true); // 1s elapsed -> 1 token refilled
    expect(bucket.tryConsume(1_000)).toBe(false); // that token was just spent
  });

  it("never refills past capacity even after a long idle gap", () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 1 });
    bucket.tryConsume(0);
    for (let i = 0; i < 5; i++) {
      expect(bucket.tryConsume(1_000_000)).toBe(true);
    }
    expect(bucket.tryConsume(1_000_000)).toBe(false);
  });

  it("defaults to the current time when now is omitted", () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerSec: 1 });
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });
});
