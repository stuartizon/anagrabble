// TDD for the error-reporting wrapper — see anagrabble#46 and
// docs/decisions.md "Error tracking: Sentry behind a reportError wrapper".
// No I/O and no real Sentry client: @sentry/node is mocked out entirely, so
// these assert the wrapper's own contract (no DSN -> no send, console
// logging preserved, tag/context shape) rather than the vendor SDK's.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
}));

vi.mock("@sentry/node", () => sentry);

import {
  ReportThrottle,
  flushReports,
  initObservability,
  isObservabilityEnabled,
  reportError,
  reportWarning,
  resetObservabilityForTests,
} from "./observability.js";

describe("ReportThrottle", () => {
  it("allows the first report for a key", () => {
    const throttle = new ReportThrottle(60_000);
    expect(throttle.allow("redis-connect", 0)).toBe(true);
  });

  it("suppresses a repeat of the same key inside the window", () => {
    const throttle = new ReportThrottle(60_000);
    throttle.allow("redis-connect", 0);
    expect(throttle.allow("redis-connect", 59_999)).toBe(false);
  });

  it("allows the same key again once the window has passed", () => {
    const throttle = new ReportThrottle(60_000);
    throttle.allow("redis-connect", 0);
    expect(throttle.allow("redis-connect", 60_000)).toBe(true);
  });

  it("throttles each key independently", () => {
    const throttle = new ReportThrottle(60_000);
    expect(throttle.allow("redis-connect", 0)).toBe(true);
    expect(throttle.allow("sweep-tick", 0)).toBe(true);
  });

  it("forgets keys that fall out of the window rather than growing forever", () => {
    const throttle = new ReportThrottle(60_000);
    for (let i = 0; i < 100; i++) throttle.allow(`game-${i}`, 0);
    throttle.allow("later", 60_000);
    expect(throttle.size).toBe(1);
  });
});

describe("observability", () => {
  beforeEach(() => {
    resetObservabilityForTests();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays disabled and never initialises the SDK without a DSN", () => {
    expect(initObservability({ dsn: undefined, environment: "development" })).toBe(false);
    expect(isObservabilityEnabled()).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("initialises with errors-only settings and no PII when given a DSN", () => {
    expect(
      initObservability({
        dsn: "https://key@example.ingest.sentry.io/1",
        environment: "production",
        release: "abc123",
      }),
    ).toBe(true);
    expect(isObservabilityEnabled()).toBe(true);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    const options = sentry.init.mock.calls[0][0];
    expect(options.environment).toBe("production");
    expect(options.release).toBe("abc123");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
  });

  it("logs but does not send when no DSN is configured", () => {
    const err = new Error("boom");
    reportError(err, { tags: { op: "test" } });
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("sends with tags and extra once enabled, and still logs", () => {
    initObservability({ dsn: "https://key@example.ingest.sentry.io/1", environment: "test" });
    const err = new Error("lua exploded");
    reportError(err, { tags: { op: "ws.command", gameId: "ABCD" }, extra: { seq: 7 } });
    expect(console.error).toHaveBeenCalled();
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [captured, scope] = sentry.captureException.mock.calls[0];
    expect(captured).toBe(err);
    expect(scope.tags).toEqual({ op: "ws.command", gameId: "ABCD" });
    expect(scope.extra).toEqual({ seq: 7 });
  });

  it("drops undefined tag values rather than sending them as strings", () => {
    initObservability({ dsn: "https://key@example.ingest.sentry.io/1", environment: "test" });
    reportError(new Error("boom"), { tags: { gameId: "ABCD", playerId: undefined } });
    expect(sentry.captureException.mock.calls[0][1].tags).toEqual({ gameId: "ABCD" });
  });

  it("wraps a non-Error throw so it still groups usefully", () => {
    initObservability({ dsn: "https://key@example.ingest.sentry.io/1", environment: "test" });
    reportError("just a string");
    expect(sentry.captureException.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("suppresses a repeat send for the same dedupeKey but keeps logging it", () => {
    initObservability({ dsn: "https://key@example.ingest.sentry.io/1", environment: "test" });
    reportError(new Error("redis down"), { dedupeKey: "redis-connect" });
    reportError(new Error("redis down"), { dedupeKey: "redis-connect" });
    // Log every occurrence (Railway logs stay as complete as before this
    // existed); send only the first, so a once-a-second failure loop can't
    // burn the monthly event quota.
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("reports a warning as a message, not an exception", () => {
    initObservability({ dsn: "https://key@example.ingest.sentry.io/1", environment: "test" });
    reportWarning("stale state on submit", { tags: { gameId: "ABCD" } });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage.mock.calls[0][1].level).toBe("warning");
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("resolves flushReports immediately when disabled", async () => {
    await expect(flushReports(10)).resolves.toBeUndefined();
    expect(sentry.flush).not.toHaveBeenCalled();
  });

  it("flushes pending events when enabled", async () => {
    initObservability({ dsn: "https://key@example.ingest.sentry.io/1", environment: "test" });
    await flushReports(10);
    expect(sentry.flush).toHaveBeenCalledWith(10);
  });

  it("never lets a failing flush reject its caller", async () => {
    initObservability({ dsn: "https://key@example.ingest.sentry.io/1", environment: "test" });
    sentry.flush.mockRejectedValueOnce(new Error("transport down"));
    await expect(flushReports(10)).resolves.toBeUndefined();
  });
});
