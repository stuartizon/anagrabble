// The only module in apps/server that imports the error-tracking vendor's
// SDK — everything else calls reportError/reportWarning, mirroring the way
// apps/web/src/auth/ is the only place that knows about Clerk. Swapping
// Sentry for something else is then one file, not every call site. See
// anagrabble#46 and docs/decisions.md "Error tracking: Sentry behind a
// reportError wrapper".
//
// What belongs here is *unexpected* failure only: an unreachable state, an
// infra fault, or a throw nobody wrote a branch for. A domain rejection
// (NotAWord, NoDecomposition, NotYourTurn, ...) is the state machine working
// correctly and must never be reported — see the same decisions.md section.

import * as Sentry from "@sentry/node";

export interface ErrorContext {
  /** Indexed, searchable, low-cardinality-ish: op, gameId, commandId,
   * command, playerId (the opaque Clerk id — never a name or email). */
  tags?: Record<string, string | undefined>;
  /** Unindexed payload for whatever else helps reproduce it. */
  extra?: Record<string, unknown>;
  /** Collapses a repeating failure to one event per window. Set it on any
   * caller that can fire on a loop (the turn-timer sweep, Redis connection
   * handlers); leave it unset for one-shot paths, where every occurrence is
   * genuinely worth an event. */
  dedupeKey?: string;
}

/** Suppresses repeat reports of the same key inside a rolling window, so a
 * per-second failure loop costs one event a minute instead of 60. Takes
 * `now` explicitly for the same reason TokenBucket does (rateLimiter.ts) —
 * it makes the behaviour testable without fake timers. */
export class ReportThrottle {
  private readonly lastAllowedAt = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  allow(key: string, now: number = Date.now()): boolean {
    // Sweep expired keys on the way past, so a long-lived process that sees
    // errors tagged with many distinct gameIds doesn't accumulate a map
    // entry per game forever.
    for (const [seen, at] of this.lastAllowedAt) {
      if (now - at >= this.windowMs) this.lastAllowedAt.delete(seen);
    }
    const last = this.lastAllowedAt.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.lastAllowedAt.set(key, now);
    return true;
  }

  /** Test-only visibility into the expiry sweep above. */
  get size(): number {
    return this.lastAllowedAt.size;
  }
}

const DEDUPE_WINDOW_MS = 60_000;

let enabled = false;
let throttle = new ReportThrottle(DEDUPE_WINDOW_MS);

export interface InitObservabilityOptions {
  /** Absent in local dev and in every test run — the whole module then
   * degrades to plain console logging, exactly as before it existed. No
   * network calls, no SDK init. */
  dsn?: string;
  environment: string;
  /** Commit SHA, so a regression can be tied to the deploy that caused it.
   * Railway injects RAILWAY_GIT_COMMIT_SHA for free. */
  release?: string;
}

/** Called once, from index.ts only — never from server.ts, which the
 * testcontainers integration tests instantiate directly and which must
 * never reach a real Sentry project. Returns whether reporting is on. */
export function initObservability(opts: InitObservabilityOptions): boolean {
  if (!opts.dsn) {
    console.log("[observability] SENTRY_DSN not set — error reporting disabled");
    return false;
  }
  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    // Errors only. Tracing/profiling is deliberately off: this backend is
    // one stateless service type, so there's no cross-service request flow
    // worth a trace yet (anagrabble#46's OTel note).
    tracesSampleRate: 0,
    // No names, emails, IPs, or request bodies. The opaque Clerk id we
    // attach ourselves as a tag is the only identifier that leaves here.
    sendDefaultPii: false,
  });
  enabled = true;
  console.log(`[observability] error reporting enabled (environment: ${opts.environment})`);
  return true;
}

export function isObservabilityEnabled(): boolean {
  return enabled;
}

function definedTags(tags: ErrorContext["tags"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function shouldSend(context?: ErrorContext): boolean {
  if (!enabled) return false;
  if (!context?.dedupeKey) return true;
  return throttle.allow(context.dedupeKey);
}

/** Logs (always, dedupe or not — Railway's log stream stays as complete as
 * it was before this module existed) and reports (unless disabled or
 * throttled). */
export function reportError(err: unknown, context?: ErrorContext): void {
  const tags = definedTags(context?.tags);
  const label = tags.op ? `[${tags.op}]` : "[error]";
  console.error(label, err, context?.extra ?? "");
  if (!shouldSend(context)) return;
  Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
    tags,
    extra: context?.extra,
  });
}

/** For a condition that isn't a thrown error but shouldn't be happening —
 * e.g. SubmitWord losing a re-verification race (game.ts's StaleState), or
 * exhausting the gameId generation attempts. */
export function reportWarning(message: string, context?: ErrorContext): void {
  const tags = definedTags(context?.tags);
  const label = tags.op ? `[${tags.op}]` : "[warning]";
  console.warn(label, message, context?.extra ?? "");
  if (!shouldSend(context)) return;
  Sentry.captureMessage(message, { level: "warning", tags, extra: context?.extra });
}

/** Give in-flight events a chance to leave the process before it exits —
 * only meaningful on the fatal paths (uncaughtException, listen failure).
 * Never rejects: a failed flush must not itself become the thing that
 * crashes shutdown. */
export async function flushReports(timeoutMs = 2_000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch (err) {
    console.error("[observability] failed to flush pending events", err);
  }
}

/** Test-only: the module keeps process-wide state by design (one SDK client
 * per process), so a suite that exercises both the disabled and enabled
 * paths needs to reset it between cases. */
export function resetObservabilityForTests(): void {
  enabled = false;
  throttle = new ReportThrottle(DEDUPE_WINDOW_MS);
}
