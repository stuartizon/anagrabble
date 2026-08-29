// Server-side fallback for TurnTile: force-advances an expired turn even
// when nobody's client is connected to fire it (anagrabble#2 — see
// docs/decisions.md "Turn-timer polling sweep" and CLAUDE.md "Turn timer
// enforcement"). Runs independently on every Node instance — stateless,
// same as every other command path — polling TURN_DEADLINES_KEY
// (gameSession.ts) for games whose turnDeadline has passed, then replaying
// the same TurnTile call a client would have made.
//
// Safe under multiple concurrent sweeps (every instance runs its own): the
// sweep never claims a specific player identity, so
// apply_turn_tile.lua's isCurrentPlayer check can never pass for the wrong
// reason the way a real client's stale call once could (see
// docs/decisions.md "Two-player double-tile-draw bug", removed alongside
// this — deadlinePassed is what lets the sweep succeed, not isCurrentPlayer).
// Whichever call lands first wins; every other concurrent call (from this
// or another instance) safely no-ops with NotYourTurn once it re-reads
// state past the first one's atomic mutation.

import type { Redis } from "@anagrabble/redis";
import type { TurnTileCommand } from "@anagrabble/protocol";
import { TURN_DEADLINES_KEY } from "./gameSession.js";
import { turnTile } from "./game.js";
import type { Broadcaster } from "./broadcast.js";
import { reportError } from "./observability.js";

const SWEEP_INTERVAL_MS = 1000;

/** Never a real Clerk user id (those look like `user_...`) — the sweep
 * relies on apply_turn_tile.lua's deadlinePassed branch to succeed, not on
 * matching isCurrentPlayer, so this only needs to be a value no real player
 * id could ever equal. */
const SWEEP_ACTOR_ID = "turn-timer-sweep";

export interface TurnTimerSweep {
  stop: () => void;
}

export function startTurnTimerSweep(redis: Redis, broadcaster: Broadcaster): TurnTimerSweep {
  let ticking = false;

  async function tick() {
    // A previous tick still catching up (a lot of games overdue at once) —
    // skip this one rather than piling up overlapping runs against the
    // same Redis connection.
    if (ticking) return;
    ticking = true;
    try {
      const dueGameIds = await redis.zRangeByScore(TURN_DEADLINES_KEY, "-inf", Date.now());
      for (const gameId of dueGameIds) {
        try {
          const command: TurnTileCommand = {
            type: "TurnTile",
            commandId: crypto.randomUUID(),
            gameId,
          };
          const result = await turnTile(redis, command, SWEEP_ACTOR_ID);
          if ("error" in result) continue;
          await broadcaster.publish({
            type: "TileTurned",
            seq: result.snapshot.seq,
            gameId,
            game: result.snapshot,
          });
        } catch (err) {
          // dedupeKey is per-game: one broken game shouldn't mute reports
          // for every other game, but it also shouldn't emit an event a
          // second for as long as it stays broken.
          reportError(err, {
            tags: { op: "turnTimerSweep.advance", gameId },
            dedupeKey: `sweep-advance:${gameId}`,
          });
        }
      }
    } catch (err) {
      reportError(err, { tags: { op: "turnTimerSweep.scan" }, dedupeKey: "sweep-scan" });
    } finally {
      ticking = false;
    }
  }

  const interval = setInterval(() => {
    tick().catch((err) =>
      reportError(err, { tags: { op: "turnTimerSweep.tick" }, dedupeKey: "sweep-tick" }),
    );
  }, SWEEP_INTERVAL_MS);

  return { stop: () => clearInterval(interval) };
}
