# Redis schema

Convention for how a game's live state is stored in Redis. See CLAUDE.md
"Core architecture: Redis as authoritative live state" for why Redis holds
this at all; this file is the concrete key/shape contract so server code
(and any future Lua scripts) agree on it.

## Keys

Keys are hash-tagged per game (`{<gameId>}`) so that if/when Redis moves to
a clustered deployment, all of one game's keys land on the same hash slot —
required for multi-key Lua scripts (`EVAL`) to work under cluster mode. Only
the part inside `{...}` is hashed for slot placement; the rest of the key
name is just for readability.

| Key                     | Type   | Purpose                                             |
| ----------------------- | ------ | --------------------------------------------------- |
| `game:{<gameId>}:state` | string | JSON blob, the full `GameState` (shape below)       |
| `game:{<gameId>}:seq`   | string | Monotonic move counter, bumped via `INCR`           |
| `game:{<gameId>}:cmds`  | set    | Recently-seen `commandId`s, for idempotency dedup   |
| `game:{<gameId>}:bag`   | list   | Shuffled tile draw order — see "Tile bag key" below |

`game:{<gameId>}:cmds` gets an `EXPIRE` (1 hour) refreshed on every add —
it's a dedup window, not permanent storage; `commandId`s don't need to be
remembered forever, just long enough to catch retries/reconnects.

There's also one cross-game key, deliberately not hash-tagged since it's an
index over every game rather than one game's own state:

| Key                   | Type       | Purpose                                              |
| --------------------- | ---------- | ---------------------------------------------------- |
| `games:turnDeadlines` | sorted set | Games with an active turn timer, for the sweep below |

`games:turnDeadlines` (`gameSession.ts`'s `TURN_DEADLINES_KEY`) scores each
tracked game by `min(turnDeadline, currentPlayer's presence deadline)` — not
just `turnDeadline` — where "presence deadline" is
`currentPlayer.lastSeenAt + PRESENCE_STALE_MS`, the same boundary
`isReachable`/`apply_turn_tile.lua`'s `currentPlayerUnreachable` check
already use, just expressed as a future timestamp so it fits the same
sorted set. `apps/server/src/turnTimerSweep.ts` polls it
(`ZRANGEBYSCORE ... -inf now`) to force-advance a turn even with nobody
connected to trigger it — either because the nominal deadline passed, or
because the current player went stale well before it (CLAUDE.md
"Disconnected-player fast-skip") — see docs/decisions.md "Turn-timer
polling sweep" for why both cases need to be in the score (a deadline-only
sweep would never notice the second one). Kept in sync from Node after
every mutation that can change `turnDeadline`/`turnPlayerId`, and after
every presence update for the _current_ player specifically, not from
inside the Lua scripts — see that decision entry for why. A game is
untracked (not just left stale) once there's nothing left to sweep for:
not `playing`, or `bankCount` has hit 0 (`TurnTile` becomes a permanent
no-op past that point, even though `SubmitWord` keeps resetting
`turnDeadline` for scoring/steal purposes).

### Tile bag key

`game:{<gameId>}:bag` holds the game's shuffled draw order (one entry per
tile, `LPOP`ped one at a time by `TurnTile`) — see `packages/game/src/bag.ts`
for the letter distribution and shuffle, and
`packages/redis/src/scripts/apply_turn_tile.lua` for the script that pops it.
It's a separate key rather than a `GameState` field specifically so it's
never sent to clients: `GameState`/`GameSnapshot` is the same shape sent
over the wire, and shipping the full remaining draw order would let a client
see every future tile before it's revealed. `StartGame` seeds it (`RPUSH`,
length = the full letter distribution) when the lobby transitions to
`playing`; it's never written to again after that.

## State shape (`GameState`, `packages/protocol`)

```json
{
  "status": "playing",
  "seq": 4,
  "config": { "turnTimerSec": 30, "minWordLength": 3, "language": "English" },
  "turnPlayerIndex": 1,
  "turnDeadline": 1750000030000,
  "endGameDeadline": null,
  "bankCount": 143,
  "pool": ["C"],
  "players": [{ "id": "p1", "name": "Alex", "words": [], "score": 0, "lastSeenAt": 1750000025000 }]
}
```

This is the same shape end to end — the lobby slice doesn't get a
lobby-only shape, it just leaves the not-yet-relevant fields at their empty
defaults while `status` is `"lobby"` (`pool: []`, `bankCount: 0` at creation,
`turnDeadline: null`, `endGameDeadline: null`). `StartGame` fills these in
(shuffling a full 144-tile bag — `packages/game/src/bag.ts` — into
`bankCount`, opening `turnDeadline`) without restructuring anything, and
`TurnTile` (`packages/redis/src/scripts/apply_turn_tile.lua`) keeps them
moving from there:

- **`status`**: `"lobby" | "playing" | "ended"`.
- **`seq`**: mirrors the dedicated `:seq` key — see "Two seq values" below.
- **`turnPlayerIndex`** / **`turnDeadline`**: the turn timer (CLAUDE.md "Tile
  turning is turn-based"). `turnDeadline` is a timestamp, checked lazily —
  the current player can fire `TurnTile` early, or the server's own
  turn-timer sweep (CLAUDE.md "Turn timer enforcement",
  `apps/server/src/turnTimerSweep.ts`) force-advances it once
  `now >= turnDeadline`, even with nobody connected; either way the Lua
  script is what actually verifies the deadline server-side.
- **`endGameDeadline`**: same lazy/client-triggered pattern as
  `turnDeadline`, but for the post-bank-empty idle countdown (CLAUDE.md
  "Game-end condition"). Null while `bankCount > 0`. Set to `now + 60000` the
  moment `bankCount` reaches 0, and reset to `now + 60000` again every time a
  `WordPlayed` event is accepted. If a client checks it and finds `now >=
endGameDeadline`, the game auto-ends.
- **`bankCount`** / **`pool`**: tile bank remaining count and the currently
  revealed/unclaimed pool letters.
- **`players[].words` / `.score`**: empty/zero until word play lands. There's
  no `.color` field — display color isn't part of the shared game state at
  all; see "Player color" below.
- **`players[].lastSeenAt`**: presence — see "Presence" below. Persisted
  alongside the rest of the player entry, but never sent to clients
  directly (clock-skew sensitive); what goes over the wire is a derived
  `presence: "connected" | "disconnected"` field, computed fresh into every
  `GameSnapshot`.

## Presence

Each `players[]` entry carries `lastSeenAt` (epoch ms, refreshed by a
client heartbeat — see docs/decisions.md "Player presence:
connected/disconnected tracking"). "Reachable" is derived at read time —
`now - lastSeenAt < PRESENCE_STALE_MS` (`apps/server/src/gameSession.ts`'s
`isReachable`, mirrored in `apply_turn_tile.lua`'s deadline check) —
rather than tracked via any scheduled timer, which is what makes it safe
for any Node process to compute the same answer. There's no separate
"explicitly left" state: mid-game, clicking "Leave game" just closes the
socket like any other disconnect (see "Host convention" below and
docs/decisions.md for why an earlier `left` flag distinguishing the two
was removed).

Writes go through a small dedicated script,
`packages/redis/src/scripts/apply_presence.lua` (wrapped by
`applyPresence.ts`), atomically patching just one player's `lastSeenAt` so
a heartbeat can't clobber a concurrent gameplay mutation to the same
`:state` blob. No new Redis key — presence lives inside the existing
`GameState.players[]` shape above, not a separate key or structure.

Unlike `turnDeadline`/`endGameDeadline`, presence writes deliberately don't
bump `seq` or get individually broadcast on every heartbeat (that would be
a lot of Pub/Sub noise for something with no gameplay consequence by
itself) — see docs/decisions.md for how clients still see it change in a
reasonable time.

## Host convention

There's no separate `hostId` field in the persisted state. The host is,
by convention, the first **reachable** player in `players` (falling back to
`players[0]` if nobody currently is) — whoever created the game, unless
they've since gone quiet. This is derived, not stored, when building the
wire-level `GameSnapshot` (which does carry `hostId`, for client
convenience, plus `gameId` since that's the Redis key rather than a field
inside the blob).

One consequence, accepted as reasonable rather than worked around: if the
host goes unreachable (closes their tab, loses connectivity) before the
game starts, host status migrates to the next reachable player automatically
— free host migration, not a special case, and unlike the old
`pendingLeaves`-era behavior, the original host isn't removed from
`players` just for going quiet; they reclaim host status themselves if they
reconnect while nobody else has grabbed it. Removal from `players` pre-start
only ever happens via an explicit `POST /games/:gameId/leave`
(`gameSession.ts`'s `leaveGame`, unchanged by the presence work — still a no-op
once `status !== "lobby"`) — never inferred from a disconnect.

## Player color

Not part of `GameState` at all — no field, no Redis key, nothing persisted
or sent over the wire. Each client computes it locally
(`apps/web/src/playerColors.ts`, `assignPlayerColors`) from data it already
has: the current `players` list plus its own player id. The viewer always
sees themselves in `--accent` (deliberately — same green as the rest of the
UI's primary accent); everyone else is ranked by `playerId` (ascending,
just a fixed deterministic tiebreak) and assigned `--player-2`..
`--player-8` in that order — so a 2-player game always gets the
most-contrasting pairing (`--accent` + `--player-2`), not whatever a
per-id hash happened to land on further down the palette (an earlier
version of this hashed independently per player; changed once it was
noticed that could pair the accent with a low-contrast color like
`--player-7`/`8` even for a 2-player game — see docs/decisions.md).

This used to be assigned server-side at join time (cycling through
`--player-1`..`--player-8` by `players.length`) and persisted as
`players[].color`. That broke down for a couple of concrete reasons, not
just preference: a player who left a lobby and rejoined got reassigned a
different color (indexed by the _current_ `players.length`, not anything
tied to their identity), and any future support for players joining or
leaving mid-game would have the same problem. Computing it per-viewer
sidesteps the storage/reassignment issue entirely — nothing is persisted,
so nothing can go stale.

Two deliberate constraints this accepts:

- **Uniqueness only up to a full 8-player roster** (7 "other" colors + your
  own accent) — the size of the reserved palette (CLAUDE.md "Design
  system"). Nothing currently caps player count at 8; beyond that, colors
  repeat. Not a problem yet — enforce the cap or add more `--player-N`
  tokens whenever it becomes one.
- **A roster change can shift an existing other player's color**, since
  rank (not identity alone) determines the assignment — e.g. someone
  leaving frees up a low slot that gets backfilled by whoever's next in
  rank. Not observable today (the roster is frozen for the whole game once
  it starts — see "Known limitations" below), so only a live concern once
  players can join/leave mid-game.

## Two `seq` values

`seq` appears both as its own key (`:seq`, an integer via `INCR`) and as a
field inside the `state` blob. The dedicated key exists because `INCR` is a
single atomic Redis command — safe under concurrent writers by itself, which
a copy embedded only inside a JSON blob wouldn't be. Every mutation reads
the next value via `INCR game:{<gameId>}:seq` first, then writes that same
number into `state.seq` when it saves the updated blob, so a plain `GET` of
`:state` alone still tells a client the current seq without a second round
trip.

`seq` starts at `0` at creation (nothing to gap-detect yet — there are no
other clients subscribed before the game exists) and increments by 1 on each
subsequent accepted mutation (a join, a leave, and later a turn/word event).

## Known limitations (deliberate, MVP-scope)

- **Join/leave/StartGame aren't compare-and-swap.** Writing `state` is a
  single `SET` (atomic on its own), but the read-modify-write around it
  (`GET` state, compute the next state in JS, `SET` it back) is not — two
  genuinely concurrent calls for the same game could race, and the second
  `SET` would clobber the first. CLAUDE.md explicitly accepts this for the
  lobby slice ("no Lua script needed yet... no real race condition in
  creating/joining a lobby"), and `startGame` (`apps/server/src/game.ts`)
  follows the same reasoning — only the host can trigger it, so there's no
  genuine concurrent-writer scenario to guard against, unlike `TurnTile`'s
  "any client can trigger the timeout path" case. If it ever matters in
  practice, the fix is the same pattern `TurnTile` already uses: read in
  Node, resolve in Node, do a cheap atomic re-verify-and-apply in a small
  Lua script (`packages/redis/src/scripts/apply_turn_tile.lua`).
- **Broadcast fan-out is process-local**, using Redis Pub/Sub to bridge
  across server processes (`apps/server/src/index.ts`) rather than each
  server holding its own separate source of truth — this is what preserves
  "any node can handle any game's command" (CLAUDE.md) as the app scales to
  more than one Node instance.
