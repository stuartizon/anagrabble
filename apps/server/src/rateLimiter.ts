// Per-connection, in-memory abuse guard for gameplay WS commands — see
// anagrabble#45. Deliberately not Redis-backed: a WS connection lives on a
// single Node instance for its whole life, so there's nothing to coordinate
// across instances, unlike the Lua-script atomicity the rest of the state
// machine relies on for correctness. This is throttling, not correctness.

export interface TokenBucketOptions {
  /** Max tokens held at once — the size of an allowed burst. */
  capacity: number;
  /** Tokens regenerated per second, up to capacity — the sustained rate. */
  refillPerSec: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly opts: TokenBucketOptions,
    now: number = Date.now(),
  ) {
    this.tokens = opts.capacity;
    this.lastRefillAt = now;
  }

  tryConsume(now: number = Date.now()): boolean {
    const elapsedSec = Math.max(0, now - this.lastRefillAt) / 1000;
    this.tokens = Math.min(this.opts.capacity, this.tokens + elapsedSec * this.opts.refillPerSec);
    this.lastRefillAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** SubmitWord/TurnTile — the two commands a script could spam to affect
 * gameplay (JoinGame/StartGame/EndGame happen at most once per connection;
 * Ping is a fixed-interval heartbeat, not user-triggered). ~5/sec burst,
 * 60/min sustained — generous for real play, well below what an abusive
 * script gains from spamming. */
export const GAMEPLAY_RATE_LIMIT: TokenBucketOptions = { capacity: 5, refillPerSec: 1 };
