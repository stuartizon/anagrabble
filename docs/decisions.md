# Anagrabble — Decisions Log

Fuller reasoning behind the choices summarized in `CLAUDE.md`. Organized by topic,
roughly in the order decisions were made. Each entry notes the decision, the
alternatives seriously considered, and why they were rejected — so a later "wait,
why didn't we just—" has an answer already on file.

---

## Backend state architecture: Redis as authoritative live state

**Decision**: Redis holds current game state; all mutations go through atomic Lua
(`EVAL`) scripts. Node servers are stateless.

**Alternatives considered**:

- **Actor model + durable event log** (Akka/Pekko Cluster Sharding + Persistence) —
  single-writer-per-game via an actor, events persisted for replay/failover.
  Cleanest correctness story in principle, but requires cluster membership,
  sharding, persistence versioning, and recovery logic to actually deliver on
  failover — substantial infrastructure for the actual scale needed.
- **Postgres row-locking** (`SELECT ... FOR UPDATE` per game row) — durable and
  operationally familiar, but higher latency per move and a hot-row bottleneck
  under contention; harder to scale write throughput than Redis.
- **Cloud-native conditional writes** (DynamoDB/Spanner-style, version-checked
  writes with retry) — viable, but ties the design to a specific cloud's managed
  DB and adds retry-under-contention complexity for multi-entity updates (word
  ownership + tile pool together).

**Why Redis won**: it's genuinely the single serialization point needed for
"first wins" correctness, achieved with the least machinery. Node servers become
interchangeable — any node can handle any game's command — which makes horizontal
scaling and node death low-stakes without needing leader election, cluster
membership, or actor placement/failover logic. The durability gap (Redis isn't a
database) is closed by writing accepted moves to Postgres after the fact, not on
the critical path.

**Key tradeoff accepted**: Redis's crash-survival story is structural (no node is
ever load-bearing for state) whereas the actor model's crash-survival has to be
deliberately engineered (persistence + recovery + rescheduling pending timers).
See "Why not Akka/Pekko" below for the concrete comparison.

---

## Why not Akka/Pekko — and the old codebase

**Decision**: Do not revive or evolve the pre-existing Akka codebase. Salvage the
_domain logic_ (word rules, dictionary validation) conceptually; rewrite the infra
layer in Node/TS + Redis.

**What the old codebase actually was**: a single-node Akka HTTP server — one
`GameManager` actor per game, in-memory state only, WebSockets via Akka Streams
hubs, a local in-process event bus. No clustering, no persistence, no command
idempotency, no explicit sequencing. If the process died, the game was gone. It
used the _mental model_ correctly (single-writer-per-game, immutable state) but
never actually implemented the distributed-systems machinery (Cluster Sharding,
Persistence) that would make Akka's approach pay off.

**Why not incrementally evolve it**: getting from that starting point to real
failover would require adding Akka Cluster, converting the actor to a sharded
entity, adding Persistence, redesigning every message as a command/event,
versioning all serialization, and rebuilding the WebSocket fanout layer with
backpressure. That's on the order of 80–90% of a rewrite, done under more
constraints than starting fresh.

**The general Pekko vs. Redis tradeoff, for future reference**: Pekko gives a
nicer _single-node_ mental model — schedule a message to yourself
(`context.scheduleOnce`), handle it later, done, no coordination needed for the
happy path. But surviving a node crash with that model requires deliberately
built persistence + recovery + reschedule-on-recovery logic. Redis's model is
slightly less elegant per-operation (poll/check a deadline stored as plain state)
but crash-survival is nearly free, because redundant checks from multiple nodes
are safe by construction — there was never a single owner to lose.

---

## Backend language: Node.js + TypeScript

**Decision**: Node.js + TypeScript for `apps/server`.

**Alternatives considered**: Go (predictable performance, simple concurrency,
more boilerplate), Rust (fastest, safest, steepest learning curve — assessed as
overkill), staying on the JVM with Redis (loses most of the reason to be on the
JVM once Redis — not the actor system — is doing the serialization).

**Why Node/TS won**: once Redis is the concurrency authority, the app server's
job is I/O — WebSockets, JSON, calling Redis — not correctness-critical
concurrency. Node's ecosystem is the most pragmatic fit for that shape of work,
plus it lets `packages/protocol` types be shared directly between server and
frontend with no serialization-format translation layer.

---

## Deployment platform: Railway (not AWS)

**Decision**: Railway for Node + Redis. Neon for Postgres. Vercel/Cloudflare Pages
for the frontend. AWS deliberately not used for MVP.

**Why**: AWS has real fixed-cost infrastructure primitives (NAT Gateway ~$32/mo,
ALB ~$16–20/mo base, minimum ElastiCache/RDS node sizes) that exist regardless of
actual traffic — realistic floor around $90–150/month even near-zero usage.
Railway's per-second usage billing means an app this size runs closer to
$5–30/month. The architecture itself (Dockerized services, Redis as the only real
architectural dependency) is cloud-agnostic — Railway is a deployment choice, not
a design constraint, so this is reversible without a rewrite if/when real HA or
infra-control needs justify AWS's floor cost.

**Alternatives considered and where they'd fit better**: Fly.io (similar
usage-based billing, no platform minimum, rougher DX), Render (flat per-instance
pricing, comparable cost at this scale, less granular than Railway), a self-hosted
VPS + Coolify (cheapest in raw dollars, ~$5/mo, but no managed failover/backups —
reasonable only if comfortable owning ops).

---

## Redis hosting: Railway (co-located), not Upstash

**Decision**: Run Redis on Railway, in the same project/private network as the
Node service, rather than Upstash.

**Why**: Railway's own Redis is reached over private networking within the same
region — sub-millisecond, effectively free latency. Upstash is a separate managed
service reached over the public internet (TCP or HTTP REST, both TLS) — even in
the best case (matched region, TCP client) it's real network time layered on top
of what Railway's private network gives for free. Given the game explicitly
depends on Redis to arbitrate near-simultaneous submissions, minimizing that
latency (and the operational surface of one more external dependency) was judged
worth more than Upstash's cost advantage at this scale.

**Revisit if**: the Railway Redis container's cost becomes the dominant line item
(Upstash's free tier is close to $0 for low command volume), or if there's a
reason to want Upstash's multi-region read replicas (e.g. players joining from
multiple continents).

**Redis HA**: deliberately staying single-instance (no Sentinel/cluster template)
for MVP — the added container count and complexity isn't justified at current
scale. Revisit once real concurrent-game volume exists.

---

## Postgres hosting: Neon, not Railway Postgres

**Decision**: Neon (free tier, scale-to-zero) for durable history, kept separate
from Railway.

**Why**: Railway's Postgres is billed on the same always-metered basis as every
other Railway service — no free tier, no scale-to-zero. Durable history is
written infrequently (after each accepted move, off the hot path), so an
instance that's mostly idle between play sessions is a poor fit for
always-metered billing. Neon's scale-to-zero makes this effectively free for a
long time. Tradeoff accepted: connections go over the public internet (TLS) to
Neon rather than Railway's private network — fine for infrequent, non-latency
critical writes; pooled connections (PgBouncer, which Neon provides) recommended
given the serverless-style connection pattern.

---

## Frontend hosting: Vercel/Cloudflare Pages, not Railway

**Decision**: Static frontend hosting on Vercel or Cloudflare Pages, separate from
the Railway project.

**Why**: no reason to serve static assets from a metered compute container when
CDN-native hosts do it for free (or near-free) with better edge distribution.
Requires explicit CORS configuration and the WebSocket client pointing at an
explicit backend URL, since frontend and backend now live on different origins/
subdomains (`anagrabble.com` vs `api.anagrabble.com`).

---

## Game rules

### Tile turning vs. word stealing are different concurrency problems

Confirmed against the actual Claude Design prototype logic: only the current
player (rotating index) may turn a tile, gated by a per-turn countdown. This is
effectively single-writer by construction. Word submission/stealing, by contrast,
is genuinely free-for-all — any player, any time — and is the actual race the
Redis/Lua atomicity design exists to resolve.

### Turn timer enforcement: client-triggered only for MVP

**Decision**: any connected client fires `TurnTile` when its local countdown
hits zero; the Lua script verifies the deadline server-side regardless of who
called it. No server-side polling sweep for MVP.

**Alternative considered**: a Redis sorted-set sweep, independently polled by
every Node instance (`ZRANGEBYSCORE` against a deadlines set) — rejected for now
as unnecessary machinery at current scale (a handful of players, presumably
attentive). Explicitly _not_ rejected as an approach — it's a clean fit later,
requires no redesign (converges on the same idempotent `apply_turn_tile` call),
just deferred until real evidence (actually-stalled games) justifies it.
**Also explicitly rejected**: Redis keyspace notifications — pub/sub is
fire-and-forget; a notification with no subscriber connected at that instant is
lost permanently, which is a worse reliability property than either alternative.

### Word formability and steal resolution

The client never specifies _how_ a word forms — the server infers the
decomposition. Full rule set and priority order are in `CLAUDE.md`. Two decisions
worth recording the reasoning for:

- **Tiebreak rule**: when multiple valid steal decompositions exist within the
  same priority tier (e.g. stealable from either of two opponents), prefer
  stealing from the **highest-scoring player**. Chosen for mild rubber-banding
  (keeps games closer) over a purely mechanical tiebreak (player order, word
  length) — a deliberate, if small, game-balance choice, not just a
  disambiguation default.
- **Implementation split**: the combinatorial decomposition search runs in
  TypeScript (`packages/game`) against a plain Redis read, producing a resolved
  plan; only a cheap re-verification + apply step runs inside the Lua script.
  Rejected: doing the full search inside Lua — Lua is a poor fit for this kind of
  logic and much harder to test than TypeScript. The atomicity guarantee is
  preserved because the actual _mutation_ is still a single atomic operation;
  only the _search_ for what to mutate happens outside it, with a "stale, retry"
  path if state moved between the read and the write.

### Game-end condition

**Decision**: once the tile bank is empty, start a 60-second idle countdown
(stored as game state), reset every time a word is played. If it expires with no
plays, the game auto-ends.

**Why**: real in-person play ends by informal player consensus, which is too
heavyweight to build for MVP (no voting UI/mechanic). The idle countdown is a
technical proxy for the same signal — "nobody sees a move anymore" — using the
same deadline-in-Redis pattern already built for the turn timer, just gated on
bank-empty and reset on `WordPlayed` instead of on turns. Explicitly swappable
later for an explicit "call the game" or "all players confirm" mechanic without
touching anything else.

---

## Protocol conventions

- **Command idempotency** (`commandId` per command, deduped in Redis) and
  **monotonic `seq`** on every accepted event (for gap detection/resync) were
  both treated as non-negotiable from the start — flagged repeatedly across the
  architecture discussion (Redis-atomic design, actor-model design, and the
  original ChatGPT thread) as necessary regardless of which backend approach was
  chosen, since clients retry and connections drop regardless of architecture.
- **Expand/contract schema evolution** for `packages/protocol`: decided once it
  became clear backend (Railway) and frontend (Vercel) deploy independently, with
  no cross-platform ordering guarantee for a single commit touching both. Rather
  than trying to engineer strict deploy ordering (possible via a custom CI
  workflow, but judged as more machinery than needed right now), the constraint
  was pushed into how protocol changes are written: additive-only per PR, with
  genuine breaking changes split into an "expand" rollout (backend tolerates old
  - new) followed by a later "contract" rollout.

---

## Repo structure

**Decision**: single monorepo, pnpm workspaces (`apps/*`, `packages/*`).

**Context**: the previous Akka-era attempt at this project used separate JS,
server, and infra repos. Explicitly not repeated here — a monorepo keeps
protocol types shared without publishing an internal package, and keeps
`CLAUDE.md`/decisions/user-stories co-located with the code they describe.

---

## Frontend framework: React + Vite

**Decision**: React, added on top of the existing Vite scaffold in `apps/web`.

**Alternatives considered**: Vue (comparable maturity, gentler learning curve),
Svelte/SvelteKit (less boilerplate, smaller bundles, good fit given the app's
modest UI surface — a handful of screens plus one real-time game view), no
framework at all (defensible given how much of the real complexity is
server-side, not UI-side).

**Why React won**: Vite was already scaffolded with no framework decision baked
in, so the marginal setup cost of adding React is small. No alternative had a
technical edge specific to this app — the Claude Design prototype's state model
(local component state, conditional rendering, list rendering) maps directly onto
any of the candidates equally well. React was chosen for ecosystem depth and
being the framework most likely to have the best available tooling/support if
outside help or Claude Code assistance is needed later. This was a
path-of-least-resistance call, not a technically-forced one — worth remembering
if a future rewrite ever feels tempting, since there's no hidden technical debt
being resolved by having chosen React specifically.

## Lobby slice: routing and Redis schema

**Decision**: one flat URL per game (`/:gameId`) for its entire lifecycle,
rather than phase-specific URLs (`/lobby/:id`, `/play/:id`, `/game-over/:id`)
with redirects between them. The single page reads `GameState.status`
(`"lobby" | "playing" | "ended"`) from the live snapshot it's already
subscribed to and renders the matching view — no client-side navigation on a
phase transition.

**Alternatives considered**: redirecting between phase-specific URLs as
`status` changes. Rejected — it reintroduces the same navigation-timing race
already hit and fixed once in this slice (see "Join Game merged into Lobby"
below): whichever URL gets bookmarked/shared is only correct for one phase,
so a "redirect if stale" check would be needed on load anyway, which the
flat-URL approach gets for free by construction.

**Namespace risk accepted**: `/:gameId` shares the URL root with any future
static pages (Rules, Settings, Stats, Login — all sketched in the design
system). Mitigated for free rather than engineered around: `makeGameId()`
already generates uppercase codes, and named routes are lowercase by
convention, so there's no actual collision as long as that holds.

**Decision**: Join Game merged into Lobby — there's no separate "preview
before you join" page. An invite link always opens `/:gameId`; a player who
hasn't joined yet sees the same lobby everyone else does, with a name field
and "Join game" button in place of "Waiting for the host…". Joining updates
the page in place over the existing WebSocket; nothing navigates.

**Why**: the two pages were ~80% duplicated (config display, player list,
join logic) before this change — a sign the split wasn't earning its keep.
Merging removed a whole state transition (navigate-on-successful-join) and
the "Joining…" flash it produced, and matches the actual mental model of an
invite link: you land where you'll actually be playing, not somewhere you
get redirected away from.

**Decision**: Redis schema is one JSON blob per game
(`game:{<gameId>}:state`), hash-tagged for future cluster-mode compatibility,
plus a dedicated `:seq` key (atomic `INCR`) and a `:cmds` set for commandId
dedup. Full convention and the `GameState` shape in `docs/redis-schema.md`.
The shape is the _full_ eventual game state (`status`, `turnPlayerIndex`,
`turnDeadline`, `endGameDeadline`, `bankCount`, `pool`, `players[].words`/
`.score`) from the start, not a lobby-only shape — the lobby slice just
leaves gameplay fields at empty defaults, so later slices fill them in
without a reshape or migration.

**Known limitation, accepted for this slice**: join/leave is a read-modify-
write (`GET` state, compute in JS, `SET` state back), not compare-and-swap —
two genuinely concurrent joins on the same game could race. Consistent with
this repo's standing rule of not reaching for Lua until a real race exists
(see "Word resolution implementation split" above); the fix, if it's ever
needed, is the same Node-resolves/Lua-reverifies pattern already planned for
word resolution.

**Decision**: broadcasting a lobby event (`PlayerJoined`/`PlayerLeft`) to
every socket watching a game goes through Redis Pub/Sub rather than an
in-process-only room map, even though there's only ever been one server
process so far. This is what keeps "any node can handle any game's command"
(the core architecture decision at the top of this file) true once there's
more than one Node process — a node that isn't holding the socket in
question still needs a way to reach it.

**Decision**: a player's WebSocket disconnecting doesn't immediately remove
them from the lobby — it schedules removal 3 seconds out, cancelled if the
same `gameId`+`playerId` reconnects first (sent as `?player=` on the socket
URL). Needed because each page opens its own socket: navigating within the
app (New Game → Lobby, or a Lobby reload) closes one connection and opens
another for the _same_ player moments later, which a naive "remove on
disconnect" mistook for that player actually leaving — including, in
testing, the host getting bounced from their own just-created lobby.

**Known limitation, accepted for now, not for production**: this is a
reasonable interim pattern (grace-period presence debouncing is standard
for realtime systems generally), but the implementation is single-process —
`pendingLeaves` is a plain in-memory `Map` in `apps/server/src/index.ts`. If
a reconnect lands on a _different_ Node process than the one that scheduled
the removal (multiple server instances, a load balancer), the cancellation
can't find the timer, and the player gets dropped after 3 seconds anyway.
Invisible today because there's only ever one server process running; a
real gap against this file's own "any node can handle any game's command"
goal once that stops being true. It's also compensating for the root cause
(one WebSocket per page, tied to the route) rather than fixing it — the
architecturally cleaner long-term fix is a single persistent connection for
the whole app session that survives page navigation, which would remove the
need for this debounce entirely. Short of that: move `pendingLeaves` into
Redis with a TTL instead of a JS `setTimeout`, so the grace period survives
a reconnect landing on any node. Revisit before running more than one
server instance.

## Explicitly still open

- **Backend HTTP framework** for the handful of non-gameplay REST routes (auth,
  lobby, stats). Current scaffold uses Node's raw `http` module for a single
  `/health` route — sufficient for now. `ws` (raw WebSocket, no `socket.io`) is
  confirmed for the gameplay channel specifically, since that's the hot path
  where framework abstraction was judged to cost more than it buys. Fastify is
  the leading candidate for the REST side once real endpoints are needed; Express
  and NestJS were considered and set aside (Express: dated patterns, weaker
  native TS ergonomics; NestJS: DI/decorator ceremony disproportionate to this
  project's actual complexity, which lives in the state machine, not routing).
- **Turn-timer polling sweep** — see "Game rules" above.
- **Dictionary source/update process** — currently assumed small enough to live
  in-memory in the Node process, loaded from a flat file. Not yet sourced.
- **Redis HA timing** — see "Redis hosting" above.
