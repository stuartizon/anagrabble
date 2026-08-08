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

| Key                          | Type   | Purpose                                              |
| ----------------------------- | ------ | ----------------------------------------------------- |
| `game:{<gameId>}:state`       | string | JSON blob, the full `GameState` (shape below)         |
| `game:{<gameId>}:seq`         | string | Monotonic move counter, bumped via `INCR`             |
| `game:{<gameId>}:cmds`        | set    | Recently-seen `commandId`s, for idempotency dedup      |

`game:{<gameId>}:cmds` gets an `EXPIRE` (1 hour) refreshed on every add —
it's a dedup window, not permanent storage; `commandId`s don't need to be
remembered forever, just long enough to catch retries/reconnects.

## State shape (`GameState`, `packages/protocol`)

```json
{
  "status": "lobby",
  "seq": 0,
  "config": { "turnTimerSec": 30, "minWordLength": 3, "language": "English" },
  "turnPlayerIndex": 0,
  "turnDeadline": null,
  "endGameDeadline": null,
  "bankCount": 100,
  "pool": [],
  "players": [
    { "id": "p1", "name": "Alex", "words": [], "score": 0, "color": "var(--player-1)" }
  ]
}
```

This is the same shape end to end — the lobby slice doesn't get a
lobby-only shape, it just leaves the not-yet-relevant fields at their empty
defaults (`status: "lobby"`, `pool: []`, `bankCount: 0` at creation,
`turnDeadline: null`, `endGameDeadline: null`). Real gameplay fills these in
without restructuring anything:

- **`status`**: `"lobby" | "playing" | "ended"`.
- **`seq`**: mirrors the dedicated `:seq` key — see "Two seq values" below.
- **`turnPlayerIndex`** / **`turnDeadline`**: the turn timer (CLAUDE.md "Tile
  turning is turn-based"). `turnDeadline` is a timestamp, checked lazily —
  any client can fire `TurnTile` once its local countdown says the deadline
  has passed; the server just verifies `now >= turnDeadline`, no polling
  sweep (CLAUDE.md "Turn timer enforcement").
- **`endGameDeadline`**: same lazy/client-triggered pattern as
  `turnDeadline`, but for the post-bank-empty idle countdown (CLAUDE.md
  "Game-end condition"). Null while `bankCount > 0`. Set to `now + 60000` the
  moment `bankCount` reaches 0, and reset to `now + 60000` again every time a
  `WordPlayed` event is accepted. If a client checks it and finds `now >=
  endGameDeadline`, the game auto-ends.
- **`bankCount`** / **`pool`**: tile bank remaining count and the currently
  revealed/unclaimed pool letters.
- **`players[].words` / `.score`**: empty/zero until word play lands; `.color`
  is assigned at join time (see "Player color" below).

## Host convention

There's no separate `hostId` field in the persisted state. The host is,
by convention, `players[0]` — whoever created the game. This is derived,
not stored, when building the wire-level `LobbySnapshot` (which does carry
`hostId`, for client convenience, plus `gameId` since that's the Redis key
rather than a field inside the blob).

One consequence, accepted as reasonable rather than worked around: if the
host's own tab disconnects before the game starts, they're removed like any
other player (see "Leaving" below), and the next player in `players` becomes
host by the same convention — free host migration, not a special case.

## Player color

Assigned by join order, cycling through `--player-1`..`--player-8`
(`packages/protocol` / `design-system` tokens) — `players.length` at join
time indexes into that list. Not stored anywhere except on the player
object itself.

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

- **Join/leave isn't compare-and-swap.** Writing `state` is a single `SET`
  (atomic on its own), but the read-modify-write around it (`GET` state,
  compute the next state in JS, `SET` it back) is not — two genuinely
  concurrent `JoinGame` calls for the same game could race, and the second
  `SET` would clobber the first player's addition. CLAUDE.md explicitly
  accepts this for the lobby slice ("no Lua script needed yet... no real
  race condition in creating/joining a lobby"). If it ever matters in
  practice, the fix is the same pattern already planned for word
  resolution: read in Node, resolve in Node, do a cheap atomic
  re-verify-and-apply in a small Lua script.
- **Broadcast fan-out is process-local**, using Redis Pub/Sub to bridge
  across server processes (`apps/server/src/index.ts`) rather than each
  server holding its own separate source of truth — this is what preserves
  "any node can handle any game's command" (CLAUDE.md) as the app scales to
  more than one Node instance.
