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

### Letters checked before dictionary

**Decision**: `resolveWordPlay` checks whether the submitted word's letters
are actually available (pool + claimed words) _before_ checking whether it's
a real word. A word that fails both checks always comes back `NoDecomposition`
never `NotAWord`.

**Why**: raised by Stuart — checking the dictionary first (the original
order, and the more obviously "cheap check first" one) means a player can
type any string that isn't currently formable at all and learn whether it's
a real word, for free, with zero risk (no letters spent, no turn used).
That's the digital equivalent of walking over to a dictionary mid-game to
scout words for later — exactly the play style the game shouldn't reward or
even enable. Checking letters first closes that off entirely: a word that
isn't formable yet gives identical feedback whether it's real or gibberish,
so there's nothing to learn by probing. Once the letters genuinely are on
the board, revealing "not a word" is fine — that's honest feedback about a
play being attempted right now, not a leak about the future.

**Traded off against**: the dictionary check is a single O(1) hash lookup,
while the decomposition search is real combinatorial work (see "Implementation
split" above) — checking dictionary-first was originally chosen partly to
fail fast on the cheap check before paying for the expensive one, so this
reorder does mean paying the search cost on every submission, including
outright gibberish. Accepted: this is a human-paced, turn-based game (not a
high-QPS hot path), the "relevant" claimed-word subset the search actually
enumerates stays small in realistic games (CLAUDE.md "Word resolution
implementation split" already bounds it), and game-design integrity outweighs
a CPU cost that's real but small at this scale.

**Scope, precisely**: this only changes behavior for words that are _both_
not real _and_ not currently formable. A real word with unavailable letters
already returned `NoDecomposition` regardless of check order (the dictionary
check passes either way); a fake word with available letters still returns
`NotAWord` either way (legitimate present-tense feedback, not a future
peek). Verified by `packages/game/src/resolution.test.ts`.

### Duplicate word claims are allowed

**Decision**: a claimed word is not a globally-unique, permanently-reserved
string. If the letters for it are genuinely available — whether from the
pool, or because someone happened to reveal more of the same letters later —
anyone (including the player who already has it) can independently claim the
identical word again. `apply_submit_word.lua` has no "already claimed" check
at all; the only constraints are letter-availability and the existing
formability rules (bare-resubmission block, derivation block, etc.), same as
any other play.

**Why**: raised by Stuart, working through a specific scenario (player 1
holds CAT; pool has C/A/S/T; player 2 steals CAT+S into CAST; C/A/T are left
untouched in the pool since the steal never needed them; can anyone,
including player 1 again, now claim a fresh CAT from those letters?). The
answer that fell out was "yes, obviously" — the letters are just letters,
and blocking a play because the _string_ happens to match something already
on the board, independent of whether the letters to build it are actually
there, doesn't correspond to any real constraint. Confirmed explicitly:
score stacks per independent claim (each one is worth full points, no
discount for a repeat) and duplicates are allowed for the same player, not
just different players — both deliberate, not oversights.

**Why this was safe to build quickly**: `apply_submit_word.lua`'s word-removal
logic was already written as count-based (`removedByOwner[owner][word] = N`,
decrementing as it walks a player's `words`) rather than identity/first-match
based — not originally written with duplicates in mind, but it meant the
mutation and scoring logic already tolerated the same string appearing more
than once in a player's list without any change. The only code that actually
assumed uniqueness was the `WordAlreadyClaimed` check itself, a single
self-contained block — removing it, and the corresponding error code
(`ApplySubmitWordError`, `ErrorEvent`), was the entire change. Swept the
codebase for any other place matching a word by value under an assumption of
uniqueness (`.includes`/`.some`/`.find` against `.words`) — found none.

**Considered and rejected**: restricting duplicates to different owners only
(blocking a single player from holding two of their own identical word,
since a physical-tiles analogy might suggest "why would you want two
identical piles"). Rejected once scoring was confirmed to stack — a player
has a clear, intentional reason to want a second copy of their own word
(more points), so there's no principled reason to allow the cross-player
case but not the same-player one.

### DerivationBlocked as its own rejection reason

**Decision**: `resolveWordPlay` reports `DerivationBlocked` — distinct from
`NoDecomposition` — specifically when a decomposition existed that used
genuinely new letters and would otherwise have been valid, but was rejected
for being a recorded dictionary derivation (CLAUDE.md "Derivation is not a
legal steal"). A bare zero-addition resubmission is _not_ treated as
`DerivationBlocked` even if the same pair happens to also be a recorded
derivation — it's checked first and folds into `NoDecomposition`, since "you
added nothing" is the more fundamental reason, and the two are conceptually
the same bucket regardless ("nothing about this is currently a legitimate
new play").

**Why split it out at all**, given `NoDecomposition`/`StaleState` were just
_merged_ into one message: raised by Stuart, drawing the line at whether the
distinction changes what the player should do next. Letters-unavailable and
bare-resubmission both mean "try something else" — no useful difference.
Derivation-blocked means something categorically different: the play _would_
have worked, and the fix is "make a bigger change," not "wait" or "try a
different word entirely." That's actionable in a way the merged cases
aren't, so it earns its own copy: "You have to change the root." — kept
short (Stuart: the fuller "not just add to it" clarification reads better
as rules-dialog prose than a fleeting toast) and deliberately not "ending"
or "suffix", since the rule itself isn't positional (see "Dictionary source
and format"'s second known gap: the actual data only records suffix-style
derivations today, but the mechanism doesn't care where the extra letters
go). The fuller phrasing lives on in
`design-system/RulesContent.dc.html`'s rules-dialog copy, matched for the same reason
(previously said "not just its ending" — corrected there too, so the
in-app rules text and the rejection toast stay consistent).

**Same anti-oracle ordering as letters-before-dictionary, one level
further**: `DerivationBlocked` can only ever be reported once a decomposition
is confirmed genuinely buildable (`findCandidates` only sets the flag after
the letter checks pass). A word that isn't buildable at all never
additionally reveals "and it would also be a blocked derivation if you
could build it" — same reasoning as checking letters before the dictionary,
just extended to this rule too, and free: the precedence check already
requires knowing letters worked before the flag can even be set.

### Scoring

**Decision**: a played/stolen word scores `1 + (word.length - minWordLength)` —
1 point at the config's minimum word length, +1 per letter beyond it (e.g. a
3-letter-minimum game: CAT=1, CAST=2, SCAT=3). Recomputed from scratch from a
player's current `words` whenever it changes (`packages/redis/src/scripts/
apply_submit_word.lua`), not tracked as an incremental +/- delta, so it can't
drift out of sync with `.words` — stealing a word away naturally drops the
old owner's score by exactly what that word was worth, with no separate
bookkeeping to keep consistent.

**Why not raw word length** (`word.length`, no minWordLength offset): this is
what the localStorage-mocked design prototype (`design-system/In Game.dc.html`)
actually computes — but CLAUDE.md already flags that prototype as
"not production code," and its own in-app rules copy
(`design-system/RulesContent.dc.html`) explicitly describes the
minWordLength-relative formula instead, so the two shipped-but-informal
references disagreed with each other. Went with the rules copy: it's the
actual player-facing explanation of the rule, and the relative formula makes
`minWordLength` (a host-configurable setting) meaningfully affect scoring
weight, not just the eligibility cutoff.

**Known tension, flagged but not solved here**: a 4-letter-minimum game is
fundamentally harder than a 3-letter-minimum one but produces systematically
lower raw scores for equivalent skill (Stuart's observation) — a problem for
any future cross-game stats/leaderboard view (`docs/user-stories.md` "I can
view my stats across past games"), not for a single game's own scoreboard.
Not addressed now since that story isn't built yet; whoever picks it up
should decide whether to normalize per-game scores for cross-game comparison
(e.g. relative to that game's config) or just not compare raw scores across
different `minWordLength` settings at all.

### Word play transfers the tile-turn

**Decision**: successfully playing or stealing a word also makes the
submitter the next player to turn a tile — `apply_submit_word.lua` reassigns
`turnPlayerIndex`/`turnDeadline` to the submitter as part of the same atomic
mutation, exactly like `apply_turn_tile.lua` does for a tile turn.

**Why this needed confirming rather than assuming**: CLAUDE.md's existing
"Tile turning vs. word stealing are different concurrency problems" framing
(above) reads as if the two systems are fully independent, and the actual
prototype code (`design-system/In Game.dc.html`) implements them that way —
`submitWord` never touches `turn`, only the tile timer does. But the
prototype's own rules copy (`RulesContent.dc.html`) says otherwise: "Whoever
makes or steals a word becomes the next player to turn a tile." Confirmed
with Stuart: the rules copy is correct, the prototype code is the
incomplete one. This does couple the two systems at the mutation level (this
Lua script now touches turn-timer fields, not just word-play fields), but the
two remain independent concurrency problems in the sense that mattered for
the original framing — a tile turn is still gated by who's current, a word
claim is still free-for-all any time; the turn just changes hands as a
_side effect_ of a word claim landing.

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

**Implementation note**: the actual deadline check/transition is `EndGame`
(command) / `GameEndedEvent`, following `TurnTile`'s client-triggered,
server-verified pattern exactly (`packages/redis/src/scripts/apply_end_game.lua`).
Two deliberate deviations from that template: `EndGameCommand` carries no
`playerId` (ending the game doesn't depend on who triggers it, unlike a tile
turn); and re-firing after the game is already `"ended"` is a no-op success,
not an error — two clients' idle timers can legitimately both expire in the
same window, and the loser landing after the winner already flipped `status`
isn't a client bug. The idle timeout itself stays hardcoded at 60s for now
(see CLAUDE.md "Still open" — CLAUDE.md's own "60–90s, configurable" phrasing
isn't wired up to `GameConfig` yet).

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
- **Rejection messages correlate by `commandId`, not "last submitted"**:
  `ErrorEvent.commandId` already exists for idempotency dedup; `apps/web`'s
  `GameBoard` also uses it client-side to tie a rejection back to the exact
  attempt that caused it (e.g. naming the actual rejected word in a `NotAWord`
  toast). Rejected alternative: just remembering "whatever word was most
  recently submitted" — simpler, but wrong under a real race (submit word A,
  submit word B before A's rejection round-trips back, A's error would
  incorrectly name B). `commandId` was already round-tripped for idempotency
  reasons, so correlating by it instead costs almost nothing and closes the
  race entirely, with no server/protocol change needed.
- **`StaleState` and `NoDecomposition` share the same rejection copy**
  _(history of how this was reasoned about, since it changed twice in one
  sitting)_: originally `StaleState` (the code meaning "another player's own
  legitimate play beat this one to the same ingredients" — see CLAUDE.md
  "Word resolution implementation split") was suppressed entirely, on the
  logic that the _winning_ player's own success toast — then broadcast to
  everyone in the room — already explained what happened, so a "you lost"
  toast on top was redundant and risked colliding with it. Once toasts
  became actor-only (next entry), that premise no longer held — the loser
  never sees the winner's toast either way, broadcast or not. Reconsidered:
  raised by Stuart that a `StaleState` rejection and a `NoDecomposition`
  rejection are indistinguishable from the player's side regardless — both
  just mean "what I tried isn't currently possible," and which one fires is
  purely a backend timing accident (did the TypeScript search already see it
  as unavailable, or did it look available and get caught by the Lua
  re-verification a moment later). A player has no way to tell those apart
  and no reason to care which happened, so `GameBoard`'s `errorText` now
  maps both to the same "That's not a legal move right now." — not
  suppressed, not distinct copy, just merged. (This originally also covered
  `WordAlreadyClaimed`, since a race could resolve to either code depending
  only on whether the two competing plays happened to land on the identical
  output word — that code no longer exists at all; see "Duplicate word
  claims are allowed" below.)
- **Toasts are personal, not broadcast narration**: a toast only ever
  reflects something about _this_ player's own screen — their own
  `SubmitWord` succeeding or failing. `WordPlayedEvent`s about a
  _different_ player's play are not shown as a toast at all, even though
  they're broadcast to and received by every client in the room; that
  information is either inferred from the board updating live, or (once
  built) shown in the persistent history panel that `design-system/In
Game.dc.html`'s desktop rail already specifies — history is explicitly
  desktop-only in that source (`railDisplay: isMobile ? 'none' : 'flex'`),
  so this is a real, accepted gap on mobile until/unless that changes: other
  players' plays are invisible there beyond the board itself updating.
  Raised by Stuart. Why: an error is, by construction, always about your own
  action — there's nothing else that could ever compete for the same toast
  slot. Making success symmetric (only your own plays toast) means the toast
  mechanism never has to arbitrate between two unrelated events again; the
  message-collision problem several entries above (`commandId` correlation,
  the `StaleState` entry above) is closed structurally rather than patched.
  Rejected alternative: a proper cascading/stacking toast queue that shows
  every event, in order, regardless of whose it is — technically solves the
  same collision problem, but adds real complexity (stacking, per-toast
  timers, a max-visible cap) to build a transient version of a list the
  history panel is going to provide permanently and properly anyway; not
  worth building twice. The actor's own toast is intentionally redundant
  with what the future history panel will also show for them — accepted,
  since the toast is the only _immediate_ confirmation until that panel
  exists.
- **History panel is client-side only, not persisted anywhere server-side**:
  `useGameSocket` accumulates every `WordPlayed` event it receives into a
  `history` array for `GameBoard`'s history panel (see the entry above —
  this is that panel, now built). It resets only when the socket effect
  itself re-runs (a genuine new connection: first page load, or a player
  joining mid-game via a fresh `gameId`) — not on every message — so it
  survives ordinary re-renders, and a future auto-reconnect implementation
  (there is none yet; today a dropped socket just goes to `status: "closed"`
  with nothing that retries it) can preserve it rather than trashing what's
  already shown. Raised by Stuart. Why: the panel is explicitly supplementary
  — the board's live state (pool, scores, word lists) is already the source
  of truth for "what's true now," so losing history on a fresh page load is
  fine, and a mid-session WS blip-reconnect (once built) silently dropping
  some entries is an acceptable, known gap rather than something worth
  building real persistence for. Explicitly not the same problem as the
  Postgres durable-history path described in CLAUDE.md's "Core architecture"
  — that's about Redis being able to rebuild authoritative game state after
  a crash; this is an ephemeral, per-viewer narration convenience with no
  bearing on correctness. If a dropped-message gap ever needs to be visible
  to players rather than just silently possible, the suggested next step
  (not built) is narrating connect/disconnect events into the same history
  list, so a viewer can at least tell something might be missing.
- **Word input dock has no border/background at any width**: while matching
  the History panel to `design-system/In Game.dc.html`'s left rail (previous
  two entries), the mobile word-submission dock was also brought in line
  with that source's `wordBarDockStyle` — which gives mobile a border-top +
  `--surface-card` background + shadow (a visually distinct docked panel)
  but leaves desktop as bare padding with no border/background at all.
  Raised by Stuart: judged a mistake in the design source, not an
  intentional mobile-vs-desktop difference — the dock should look the same
  (no border, no separate background) at every width. `apps/web`'s
  `.wordFormDock` now has no border/background at any breakpoint; only the
  padding still varies (mobile keeps `env(safe-area-inset-bottom)`, a device
  notch concern, unrelated to the look). Worth knowing this is a deliberate
  divergence from that source file, not an oversight, if `In Game.dc.html`
  is ever revisited as a reference.
- **Desktop word input dock keeps a guaranteed top padding, unlike the
  design source**: `wordBarDockStyle`'s desktop variant has zero top padding
  (`'0 28px 24px'`) — harmless when the scroll area above has slack, but
  collapses to nothing once the board content is tall enough to fill or
  overflow it (e.g. a large pool of upturned tiles), leaving the word input
  flush against whatever's directly above with no breathing room. Raised by
  Stuart, noticing asymmetric spacing (generous below the dock, none above)
  that got worse the more content was on screen. Mobile's variant already
  guards against this with 16px top padding regardless of content length;
  desktop now does too, at 24px (matching the section-to-section rhythm used
  elsewhere — `.board`'s own `gap`, `.historyRail`'s `gap`) — another
  deliberate divergence from `In Game.dc.html`, same spirit as the
  border/background entry directly above.

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

## Player color: computed client-side, not server-assigned

**Decision**: a player's display color isn't part of `GameState` at all —
no `players[].color` field, nothing in Redis, nothing on the wire. Each
client computes it locally (`apps/web/src/playerColors.ts`,
`assignPlayerColors`): the viewer always sees themselves in `--accent` (the
same green used elsewhere as the UI's primary accent — deliberate, not
incidental), and every other player is ranked by `playerId` (ascending — a
fixed, arbitrary tiebreak, not meaningful in itself) and assigned
`--player-2`..`--player-8` in that order.

**Alternatives considered**:

- **Server-assigned by join order** (what actually shipped first, in the
  lobby slice, before this was revisited): `players.length` at join time
  indexed into `--player-1`..`--player-8`, stored on `PlayerState`, sent
  over the wire. Rejected for two concrete failure modes, not just
  aesthetics: a player who left a lobby and rejoined got reassigned a
  different color (indexed by current roster size, not anything tied to
  their identity), and the same problem would recur for any future
  mid-game join/leave support.
- **Independent hash per id, collisions resolved by probing** (this
  package's first client-side attempt): hash each other player's `playerId`
  into a preferred slot among `--player-2`..`--player-8`; on a collision,
  whichever id sorts first keeps the slot, the loser probes forward. This
  genuinely never reassigns a player's color for reasons unrelated to them
  (no dependency on roster size or order), and guarantees uniqueness — but
  it was rejected once a concrete downside surfaced: with only 2 players in
  a game, the lone opponent has a 1-in-7 chance of hashing to
  `--player-7`/`--player-8`, both of which read as low-contrast against the
  `--accent` green (checked against the actual token values — they're
  visually close). A hash has no reason to prefer the palette's
  more-distinct end, so the _common_ case (small games) wasn't reliably
  getting the best pairing.
- **Pure independent hash per id, no collision resolution**: simplest
  possible option, rejected early for not guaranteeing uniqueness at all —
  two other players could land on the same color.

**Why the sorted-rank version won despite the roster-order-sensitivity
that ruled it out earlier**: once "small games should always get the most
contrasting colors" became a real requirement, it stopped being optional —
guaranteeing that is inherently a _rank_ property (it needs to know how
many others there are and fill the palette from the front), which no
per-id-only function can give you. The hash+probe version optimized for "a
player's color never moves for unrelated reasons"; the sorted-rank version
optimizes for "colors are always maximally distinct for however many
players are actually in the game," which was judged more valuable — good
contrast in the common 2-4 player case beats stability against a roster
change that, today, can't even happen mid-game (see the limitation below).

**Known limitations, accepted for now**:

- **Uniqueness only up to a full 8-player roster** (7 "other" colors plus
  the viewer's own accent) — the size of the reserved `--player-N` palette
  (CLAUDE.md "Design system"). Nothing currently enforces a player-count
  cap; beyond 8, colors repeat. Fix whenever it matters: enforce the cap,
  or add more palette tokens.
- **A roster change can shift an existing other player's color**, since
  rank determines the assignment, not identity alone. Not observable
  today — the roster is frozen for the whole game once it starts (`lobby.ts`
  rejects `JoinGame` once `status !== "lobby"`; `leaveGame` is a no-op once
  it has) — so this only becomes a live concern once players can join or
  leave mid-game, which isn't built yet. Revisit then; a common enough
  pattern elsewhere (chat/presence UIs reassigning avatar colors as a
  roster changes) that it may just be acceptable as-is.

## Dictionary source and format

**Decision**: sourced from Stuart's earlier Akka-based POC
(`anagrabble-server/src/main/resources/dictionary.txt`, ~279k words, originally
tab-separated). Checked into `packages/game/data/dictionary-source.csv`
content-unchanged but reformatted to comma-separated (see "comma vs. tab"
below). A build script (`packages/game/scripts/build-dictionary.mjs`,
`pnpm build:dictionary`) transforms it into `packages/game/data/dictionary.csv`,
which is what `packages/game/src/dictionary.ts` actually loads at runtime.

The format is one word per line, with an optional second column naming the word
it derives from — e.g. `abated,abate` means ABATED is just ABATE plus a suffix,
so stealing ABATE into ABATED (rather than combining distinct words) is not a
legal play (see CLAUDE.md "Word formability" — this is additional detail on top
of what's written there). Root chains in the original source are only one hop
(e.g. `abasedly -> abased`, and separately `abased -> abase`); the build script
walks each chain to its ultimate root and flattens it (`abasedly -> abase`
directly) so the runtime check is a single map lookup, not a chain walk.
Verified against the source data: 0 cycles, max chain depth 2 hops.

**Alternatives considered**:

- **Walk the chain at game-time** instead of pre-flattening — rejected: the
  decomposition search already runs on every word submission (CLAUDE.md "Word
  resolution implementation split"), and a chain walk per candidate steal is
  needless repeated work when it's invariant data computable once.
- **JSON instead of a delimited flat file** for the shipped dictionary —
  rejected: ~279k entries as JSON (quoted keys/values, braces, commas)
  meaningfully inflates file size for no parsing benefit; splitting each line
  on a single character is already trivial.
- **Comma vs. tab delimiter**: switched from the POC's original tabs to commas
  — no functional difference (no word contains either character, so neither
  needs escaping), but `.csv` opens directly as a spreadsheet in Excel/Sheets,
  which matters given the dictionary is expected to need manual refinement
  later (see "known gap" below).

**Known gap, accepted for now**: the source data's root annotations are
incomplete/inconsistent (e.g. `abaser` has no recorded root, though it plausibly
derives from `abase`) — noted by Stuart as a known limitation of the POC
dictionary, not something this transform can fix. Refine the source data later
if derivation blocking turns out to be too permissive in practice; the
build script requires no changes to pick up a corrected source file.

**Second known gap, found while designing `DerivationBlocked` copy**: the
derivation data appears to be suffix-only — checked several classic
prefix-derivation pairs against the actual dictionary (`disinformation`/
`information`, `unhappy`/`happy`, `antisocial`/`social`, `nonfiction`/
`fiction`, `rewrite`/`write`, `disorder`/`order`, `impossible`/`possible`)
and none have a recorded root at all, consistent with this data likely being
generated by a stemmer, and English stemmers conventionally only strip
suffixes. Concretely: today, stealing HAPPY into UNHAPPY would go through
uncaught, even though it's the same category of triviality the derivation
rule exists to block for suffixes. The blocking _mechanism_ itself
(`isDerivedFrom`) is fully agnostic to this — it's a pure `rootOf` lookup
with no concept of position, so a corrected source file with prefix
relationships recorded would be caught with zero code changes, same as the
first gap. Not fixed here; flagged for whenever the dictionary itself gets
revisited. Deliberately not written as a `docs/user-stories.md` entry — that
file is player-facing feature asks, and this is a data-quality gap in
something already built, not a new capability to request.

## Game-over summary replaces GameBoard entirely, not an overlay on it

**Decision**: once `lobby.status === "ended"`, `LobbyPage` renders
`GameOverSummary` (its own centered-`Card` screen, matching design-system/
`Game Over.dc.html`) instead of `GameBoard`. The tile pool, sidebar, and word
form all disappear at that point rather than staying mounted with a summary
overlaid on top. Previously `GameBoard` itself rendered an inline "Game
over — no more moves" message in place of the word form, keeping the rest
of the board visible — that was a deliberate stand-in for this not-yet-built
story, not the intended end state.

**Why**: the tile pool and turn/idle countdowns have nothing left to say
once the game has ended — there's no next action they're informing. The
design source treats game-over as its own screen, and the codebase already
has this exact pattern (`LobbyPage`'s pre-game waiting-room card, and its
"Game not found" card) for "swap the whole page content based on game
status," so this isn't a new shape, just another status branch.

**Ranking ties**: `GameOverSummary` uses standard competition ranking (equal
scores get the same rank number, e.g. 1, 1, 3 — never 1, 2, 3) and a
distinct winner line for a tie ("Sam and Jo tie at 6." vs. "Sam wins with
8."). The design prototype's own demo data has no tied scores, so it never
had to decide this; sequential ranking would visually imply one tied player
beat the other, which is wrong.

## Word-count badge dropped, not deferred

**Decision**: the "live score and word-count updates" user story ships with
score only. The numeric word-count badge design-system/`In Game.dc.html`'s
mobile menu shows next to each player's score (`p.wordCount`, see that
file's mobile-menu `Players` block) is deliberately not built — not a
"needs a design call" holdover, a settled no.

**Why**: each player's claimed-words list is already visible — the desktop
sidebar's word sections and the main board's "Everyone else's words"/"Your
words" panels — so the word count is already readable by counting tags on
screen. A redundant digit restating that count next to the score wasn't
judged worth the extra UI. The one place it'd add real information (the
mobile hamburger-menu overlay, where the word lists themselves aren't
visible) was judged not to matter enough on its own to justify building
just for that view.

## Auth provider: Clerk, not a hand-rolled `users` table

**Decision**: real accounts (the "sign up / log in" user story) go through
Clerk rather than a Postgres `users` table with our own password hashing,
session issuance, and OAuth handling. `apps/web` talks to Clerk directly for
sign-up/login/session; the backend doesn't verify Clerk sessions yet (see
"Explicitly still open" below) — this first slice is the login/signup screen
itself, not gating gameplay or linking games/stats to an account.

**Alternatives considered**: a Postgres `users` table with our own password
hashing (bcrypt/argon2), session cookies, rate-limiting, and a hand-rolled
Google OAuth redirect/token-exchange flow, plus a transactional-email
pipeline for password reset (nothing like that exists in the stack today).

**Why**: the same logic that picked Neon over self-hosted Postgres and
Railway over raw compute — pay for managed infrastructure where the mistake
cost is high and the product differentiation is zero. Password storage and
OAuth are exactly that: getting them wrong is a real security incident, and
neither is anything a word game needs to own. The design
(`design-system/Log in, Sign up.dc.html`) already specifies both
email/password and "Continue with Google," and Clerk gives us both plus
password-reset email delivery without standing up a new email-sending
dependency. Tradeoff accepted: identity is no longer canonical in our own
Postgres — `stats`/game-ownership tables will need to foreign-key against a
Clerk user ID rather than a locally-owned row, and the whole app now depends
on Clerk's uptime for login. Reasonable at this project's scale (free tier
covers it comfortably); revisit if Clerk's pricing tiers or an outage ever
become a real problem.

**Implementation note**: `@clerk/clerk-react` is deprecated — use
`@clerk/react` (their Core 3 / v6 rewrite). Its default `useSignIn`/
`useSignUp` hooks return a new signal-based "Future" API for custom flows;
the classic `{ isLoaded, signIn/signUp, setActive }` shape (used by
`LoginPage.tsx`) now lives at the `@clerk/react/legacy` subpath instead.
`SignedIn`/`SignedOut` are also gone, replaced by a single
`<Show when="signed-in">`/`<Show when="signed-out">` component.

---

## Backend Clerk session verification: plumbing only, not gating yet

**Decision**: `apps/web`'s `useGameSocket` fetches the current Clerk session
token (`useAuth().getToken()`) before opening its WebSocket and attaches it
as `?token=`, alongside the existing `?game=`/`?player=` params. `apps/server`
verifies it (`src/auth.ts`'s `verifySessionToken`, using `@clerk/backend`'s
`verifyToken` against `CLERK_SECRET_KEY`) and stashes the result as
`meta.clerkUserId` on the socket — see `src/index.ts`. This is deliberately
just plumbing: no command is gated on it, and nothing links a game/player to
`clerkUserId` yet. An unset `CLERK_SECRET_KEY`, a missing token, or a failed
verification all fall back to the same "not signed in" state a socket has
today — anonymous play via `playerIdentity.ts` is untouched.

**Why split it this way**: the natural next step after "the login screen
exists" is "the backend can tell who's signed in," but gating gameplay on it
and deciding how games/stats key off a Clerk user ID are separate, larger
design questions (does creating a game require sign-in? do anonymous players
get a grace period? how does `playerIdentity.ts`'s local stub id map onto a
Clerk id on login?). Landing verification alone first means those questions
get answered against working plumbing instead of alongside it.

**Implementation gotcha worth recording**: `@clerk/backend`'s own
`tokens/verify.d.ts` doc comment describes `verifyToken` as returning
`Promise<{ data, errors }>` (a non-throwing result object) — but the
function actually re-exported from the package root (`@clerk/backend`'s
`index.d.ts`/`index.js`) is wrapped in a "legacy" adapter
(`withLegacyReturn`) that resolves with the JWT payload directly and
**throws** on an invalid/expired token instead. The two coexist in the same
package version (3.16.1) with no deprecation note on either — following the
documented `{ data, errors }` shape against the top-level import silently
type-checks to `unknown` (its `CustomJwtSessionClaims` index signature masks
the mismatch) rather than erroring, so it doesn't get caught by TypeScript
either. `verifySessionToken` just wraps the whole call in try/catch and
returns `null` on any throw, sidestepping which shape is real.

---

## Account avatar: hand-rolled circle, not Clerk's `UserButton`/`UserAvatar`

**Decision**: `Header`'s signed-in avatar (round accent-green circle,
initial letter, dropdown with name/email + Log out) is our own component
(`AccountStatus` in `Header.tsx`), not Clerk's prebuilt `UserButton` (avatar

- full account-management dropdown) or `UserAvatar` (avatar image only).
  Always shows the initial, never the user's actual photo (Clerk's
  `user.imageUrl`, e.g. their real Google profile picture) — considered and
  deliberately skipped, not an oversight.

**Alternatives considered**: Clerk's `UserButton` — same avatar-plus-dropdown
shape we built by hand, but with a real profile photo when one exists, a
"Manage account" screen (password/connected accounts/sessions, Clerk-hosted,
works standalone), a `customMenuItems` prop (where "Stats"/"Settings" links
could slot in once those pages exist), and none of it built or tested by us.

**Why not**: this project has leaned hard on matching
`design-system/New Game.dc.html`'s avatar exactly (34px, `var(--accent)`,
IBM Plex) — `UserButton`'s default look is Clerk's own styling, and clawing
it back to ours means fighting their `appearance` theming API instead of
just writing CSS, with room to drift on SDK upgrades. It's also a sealed
component: `Header.test.tsx`'s coverage (initial-letter fallback, menu
open/close, outside-click, log out) tests our own logic directly by mocking
Clerk's hooks; swapping to `UserButton` would mean testing "did Clerk's
component render" instead of that. And it brings account-management surface
(session switching, security settings) this story doesn't ask for yet.

**Revisit if**: the account-management features `UserButton` bundles for
free (profile editing, connected accounts, session management) become
worth building — at that point `UserButton` most likely stops being "extra
we don't need" and starts being a real shortcut over building the same
screens ourselves.

---

## Player identity: Clerk id, no anonymous play

**Decision**: three related calls, made together once "Backend Clerk
session verification" (above) landed as inert plumbing:

1. **No anonymous play.** `/` and `/:gameId` are gated on being signed in
   (`apps/web/src/components/RequireAuth.tsx`), redirecting to `/login` and
   back via `location.state.from` once the visitor signs in. Creating or
   joining a game is no longer possible without a Clerk session.
2. **Player identity is the Clerk user id**, not a locally-generated one.
   `apps/web/src/playerIdentity.ts` (a localStorage stub: random UUID +
   editable nickname, predating auth entirely) is deleted. `hostId`/
   `playerId` in `CreateGame`/`JoinGame`/`StartGame` commands are now
   `useAuth().userId`. Redis stores `players[].id` as an unconstrained
   opaque string (see docs/redis-schema.md), so this is a value-format
   change only — no server or schema change was needed.
3. **The editable per-game nickname is dropped.** The player's name is
   now always their Clerk account's `firstName`, falling back to their
   email if unset (`apps/web/src/clerkDisplayName.ts`'s `getDisplayName`,
   also used by `Header`'s `AccountStatus`). The "Your name" input on New
   Game / Join Game is gone, replaced on sign-up by a single "First name"
   field (`LoginPage.tsx`) that's the only name the app ever collects.

**Why**: gating and identity-linking were the two questions "Backend Clerk
session verification" explicitly deferred. Dropping the editable nickname
was a judgment call made alongside them — once identity is
account-backed, letting someone type a different display name per game
adds a spoofing-adjacent surface (impersonating another player by name)
for no real benefit.

**Name source — `firstName`, not `unsafeMetadata`, not first+last**:
this went through two revisions before landing.

- First cut: stored the sign-up name in `unsafeMetadata.displayName` (a
  free-form, client-writable metadata bag) rather than Clerk's native
  name fields, to avoid any Clerk Dashboard configuration. Rejected once
  noticed that Google sign-in never populates it — that path never calls
  `signUp.create()`, so `unsafeMetadata.displayName` is simply never set
  for an OAuth account, and the app silently fell back to their email.
- Considered enabling Clerk's "First and last name" attribute as
  **required**, with the sign-up form split into two fields (`firstName`
  - `lastName`), so `fullName` would be guaranteed non-null with no
    fallback ever needed. Rejected: the game only ever displays a first
    name, so collecting and validating a last name it has no use for is
    data collection without a product reason, and it would force the
    sign-up form to deviate from the single-field design mock
    (`Log in, Sign up.dc.html`).
- Landed on: Clerk's "First and last name" attribute enabled but **not**
  required, sign-up form keeps one field, relabeled "First name" and
  passed as `firstName` on `signUp.create()`. This is Clerk's real,
  native field — Google OAuth populates it the same way password
  sign-up does, so both paths converge with no special-casing. The
  tradeoff accepted: because it isn't required at the Clerk config
  level, nothing guarantees `firstName` is ever set (an account created
  outside this form could lack one), so `getDisplayName`'s fallback to
  email is a **permanent** part of the design, not a transitional patch
  standing in for a future guarantee.

**Deferred, not forgotten — server-side identity enforcement.** This
change only swaps _where the client gets its id from_. The server still
never checks a command's `playerId`/`hostId` against the connection's
verified identity: `apps/server/src/index.ts` sets `meta.clerkUserId` from
the verified session but every command handler in `game.ts`/`lobby.ts`
trusts whatever id string the payload asserts, regardless of who's
actually connected. A client can still claim to be any player id in a
command payload. Closing this requires synchronous verification before
command handling (currently fire-and-forget in `index.ts`) and touches
every handler in both files — deliberately out of scope for this change,
tracked here so it isn't lost.

**Manual prerequisite — Clerk Dashboard config.** For `firstName` to be
accepted on `signUp.create()` at all, "First and last name" must be
enabled (not required) under **User & authentication** in the Clerk
Dashboard. This is an external config change outside the codebase —
nothing here enforces or verifies it's been done.

---

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
- **Redis HA timing** — see "Redis hosting" above.
- **Server-side identity enforcement.** Gameplay is now gated on sign-in
  and player identity is the Clerk user id (see "Player identity: Clerk
  id, no anonymous play" above), but the server still trusts whatever
  `playerId`/`hostId` a command payload asserts rather than checking it
  against the connection's verified `meta.clerkUserId`. See that section's
  "Deferred, not forgotten" note.
- **Linking games/stats to a Clerk user ID durably** — nothing writes
  history to Postgres yet at all (gameplay is Redis-only, per "Backend
  state architecture" above), so this is blocked on that landing first,
  not on identity — identity is already Clerk-based.
