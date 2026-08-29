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

## Deploy gating: Railway/Vercel wait for CI, via a custom deploy job

**Decision**: reversed the earlier "no strict deploy ordering" call (see
"Expand/contract schema evolution" under "Protocol conventions" below). Both
Railway and Vercel were auto-deploying straight off the GitHub push webhook,
independent of `.github/workflows/ci.yml`'s lint/format/typecheck/build/test
gate — a red `main` could still reach the Dev environment (`dev.anagrabble.com`
/ `api-dev.anagrabble.com` — the only environment actually live; see
README.md "Environments", Production is still unprovisioned). `ci.yml` now
has `deploy-backend` and `deploy-frontend` jobs, each `needs: [lint, format,
typecheck, build, test]` and gated to `push` on `main` only (not PRs), that
run the Railway CLI (`railway up
--service ... --environment development --ci`) and Vercel CLI (`vercel pull
--environment=production` / `build --prod` / `deploy --prebuilt --prod`)
directly, authenticated via repo secrets (`RAILWAY_TOKEN_DEVELOPMENT`,
`RAILWAY_SERVICE_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).
Both jobs target the Dev environment and fire automatically on every push to
`main`. Vercel's own environment naming doesn't have a "development" tier
distinct from Preview/Production, so the Dev deploy job uses Vercel
Production (see below) — the "Dev" framing is about which app environment
(`dev.anagrabble.com`, Clerk dev instance, etc.) it's promoted to, not a
Vercel-side environment name.

**Lint/format/typecheck/build/test run as five separate parallel jobs, not
one combined `test` job.** Originally a single `test` job ran all five
checks sequentially in one runner; each now gets its own job (its own
checkout/install), and both deploy jobs `needs:` all five. None of the five
depend on another's output (`pnpm test` runs Vitest directly against source,
not built output — see "Testing strategy"), so splitting them only costs
five parallel runners' worth of redundant checkout/install instead of one
sequential runner's worth of wall-clock time, which is the better trade once
the checks are slow enough that their sum matters more than a few
duplicated `pnpm install`s.

**Production deploys are a separate, manually-triggered pair of jobs in
their own workflow file**, `.github/workflows/deploy-production.yml`
(`deploy-backend-production`/`deploy-frontend-production`), added once
Production's Railway environment existed to deploy to. That workflow's only
trigger is `workflow_dispatch` — it was initially a `workflow_dispatch`
addition to `ci.yml`'s own `on:` block, gated `if: github.event_name ==
'workflow_dispatch'`, but that mashed a purely-manual promotion path into
the same file as every push/PR-triggered job, so it was split out. Unlike
the Dev deploy jobs, the production jobs have no `needs:` on the lint/format/
typecheck/build/test jobs and don't re-run any of them — promotion only ever targets
`main`, which already passed that gate on the push that landed it, so
re-running it here would just be redundant latency on every promotion, not
an additional safety check. Deliberately not given any
extra confirmation step (e.g. a required text input) beyond what
`workflow_dispatch` itself already demands (navigating to the Actions tab,
picking the `Deploy to production` workflow and branch, clicking "Run
workflow") — revisit with a GitHub Environment + required reviewers if that
ever proves too easy to trigger by accident. Railway's production job needs its own
`RAILWAY_TOKEN_PRODUCTION` secret — the existing `RAILWAY_TOKEN_DEVELOPMENT`
was deliberately scoped to the project's `development` environment only (see
above), so it has no access to `production` by design and a
same-privilege-as-dev token would defeat that isolation; the `_DEVELOPMENT`
suffix on the dev secret's name (renamed from a bare `RAILWAY_TOKEN`) exists
so the two are symmetric and neither reads as the unscoped default.
`RAILWAY_SERVICE_ID`
is shared (same service, selected per-call by `--environment`). Vercel's
production job reuses the existing `VERCEL_TOKEN`/`VERCEL_ORG_ID`/
`VERCEL_PROJECT_ID` secrets unchanged — Vercel tokens aren't
environment-scoped the way Railway's project tokens are — and, like the Dev
deploy job (both now run `vercel deploy --prod`), needs no alias step:
`vercel deploy --prod` lands on whatever domains are already assigned as
Production in the Vercel dashboard.

**`dev.anagrabble.com` is connected to the Vercel project's Production
environment via Vercel's dashboard domain assignment, not a CI alias
step.** An earlier version of the Dev deploy job (`deploy-frontend` in
`ci.yml`) deployed with `vercel deploy --prebuilt` (no `--prod`), landing as
a Preview deployment, and then ran a follow-up `vercel alias set <url>
dev.anagrabble.com` step (using the URL captured from the `Deploy` step's
stdout via `$GITHUB_OUTPUT`) to point the domain at it — because Vercel's
native branch-to-domain GUI setting wasn't usable from the GUI at the time,
and Preview deployments aren't otherwise addressable by a stable domain.
That approach proved unreliable in practice, so the Dev deploy job was
switched to deploy straight to Vercel Production (`--prod`, same as the
production-promotion job) with `dev.anagrabble.com` assigned to it directly
in the Vercel dashboard — removing the CI-side alias step entirely.

**Why a custom workflow over each platform's native "wait for CI" toggle**:
both Railway (Settings → Source) and Vercel (Settings → Git) have a built-in
setting that holds their push-triggered deploy until the commit's GitHub
check succeeds, at zero workflow cost. That's the lower-machinery option and
was offered first; the custom-workflow route was chosen instead to keep the
actual deploy trigger and its conditions in version control rather than
dashboard-only settings, at the cost of owning the CLI invocations and their
secrets.

**Prerequisite (manual, dashboard-side, not done as part of this change)**:
each platform's own auto-deploy-on-push must be turned off, or it races the
new workflow job and can still ship an unreviewed commit first. Railway:
Settings → Source → disable automatic deploys for the `development`
environment's service. Vercel: Settings → Git → disable automatic
deployments (or otherwise stop the Git integration from redeploying on every
push to `main`, since that's the branch this job now also deploys from). The
five secrets above must exist in the repo's GitHub Actions secrets before the
new jobs can run.

**Does not replace expand/contract**: gating on the same lint/format/
typecheck/build/test jobs removes
the "one deploy still mid-flight while the other already shipped" case for a
_failing_ commit, but Railway and Vercel are still two separate deploy jobs
with no ordering guarantee between each other for a single _passing_ commit —
backend and frontend can still momentarily be one commit apart. Additive-only
protocol changes plus expand/contract rollouts (below) remain the actual
mechanism for tolerating that gap; this change only keeps a red build from
reaching either platform at all.

**`RAILWAY_SERVICE_ID`/`CLOUDFLARE_ACCOUNT_ID` reclassified as GitHub
Actions Variables, not Secrets, 2026-08-15**: same reasoning as
`CLERK_PUBLISHABLE_KEY` in "Runtime-injected frontend config, not
build-time `VITE_*` vars" below — both are identifiers, not credentials.
A Railway/Cloudflare service or account ID names _which_ resource to act
on; it grants no access by itself (that's what `RAILWAY_TOKEN_*`/
`CLOUDFLARE_API_TOKEN` are for), and `CLOUDFLARE_ACCOUNT_ID` is already
visible in the Cloudflare dashboard's own URL. Treating them as Secrets
bought masked-logs/write-only friction for values that were never
confidential. `CLOUDFLARE_API_TOKEN` and both `RAILWAY_TOKEN_*` stay
Secrets — those are real bearer credentials.

**Superseded 2026-08-15**: the Vercel-specific mechanics above (dashboard
domain assignment, `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`,
`vercel deploy --prod`) describe how the Dev/Production frontend deploy jobs
worked before the Cloudflare Pages cutover — see "Frontend hosting cutover:
Vercel to Cloudflare Pages" below. Kept here as the historical record of why
the CI-side-alias approach was tried and abandoned in favor of a
dashboard-assigned domain, which is the same shape the Cloudflare cutover
reused (branch alias + dashboard custom-domain assignment, no CI-side alias
step either).

---

## Frontend hosting cutover: Vercel to Cloudflare Pages

**Decision**: `deploy-frontend`/`deploy-frontend-production` (`ci.yml`/
`deploy-production.yml`) now deploy to Cloudflare Pages (`wrangler pages
deploy`) instead of Vercel. `dev.anagrabble.com` and the production domain
are both repointed at Cloudflare Pages custom domains (on the `dev` and
`production` branch aliases respectively), and the Vercel deploy jobs are
removed entirely rather than kept as a second, now-redundant deploy path.

**Why now**: the `deploy-frontend-cloudflare`/`deploy-frontend-production-
cloudflare` shadow jobs (see "Explicitly still open" below for the
evaluation that added them) had been running alongside the real Vercel jobs
since 2026-08-14, deploying to Cloudflare's own `.pages.dev` URLs with no
effect on either live domain. Once that shadow run was confirmed working,
the DNS/custom-domain cutover was done first (both domains repointed to
Cloudflare, verified serving real traffic) — and only once that held was the
CI change made: promote the `-cloudflare` jobs to be `deploy-frontend`/
`deploy-frontend-production` and delete the Vercel jobs outright, rather than
leaving both in place. Doing the DNS cutover before the CI change avoided a
window where the CI job was already gone but a domain was still silently
pointed at a Vercel deploy that would no longer update.

**Sequencing rationale for pairing this with the environment-agnostic
frontend build** (see "Explicitly still open" in CLAUDE.md): the two
platforms' shadow jobs had genuinely different build mechanics (Vercel's
`vercel pull`/`vercel build` baking `VITE_*` via Vercel's own env-pull step,
Cloudflare's job baking them via plain `pnpm build` + GitHub Actions
secrets), so making the bundle environment-agnostic would otherwise have
meant implementing the runtime-config stamp step twice. Doing the platform
cutover first means it's only ever implemented against Cloudflare.

**Not done as part of this change**: the `VERCEL_TOKEN`/`VERCEL_ORG_ID`/
`VERCEL_PROJECT_ID` repo secrets and the Vercel project/dashboard settings
(auto-deploy toggle, domain assignments) are unused now but not deleted —
low-risk to leave dangling short-term, worth cleaning up once the cutover
has run on `main` a few times without needing a rollback.

---

## Runtime-injected frontend config, not build-time `VITE_*` vars

**Decision**, 2026-08-15: `apps/web`'s deployed config (`API_URL`, `WS_URL`,
`CLERK_PUBLISHABLE_KEY`) is no longer baked into the JS bundle at build
time via `import.meta.env.VITE_*`. Instead: CI runs one unparameterized
`pnpm --filter @anagrabble/web build`, then a separate step writes
`dist/env.js` (`window.__ENV__ = { API_URL: "...", ... }`), immediately
before `wrangler pages deploy`. The app reads `window.__ENV__` via
`src/env.ts`, populated by a plain `<script src="/env.js">` tag added to
`index.html` before the app's module script. `VITE_AUTH_MODE` is
unaffected — it's genuinely build-time (only read via `pnpm dev`/`docker
compose`, never part of the CI build), so it keeps the `VITE_` prefix and
stays in `apps/web/.env`.

**Why the `VITE_` prefix is dropped for the other three**: it only ever
signaled Vite's build-time static-replace-at-`import.meta.env` mechanism.
Once the values are read from `window.__ENV__` at runtime instead, keeping
the prefix would misleadingly imply a build-time var that no longer exists.

**`API_URL`/`WS_URL` are literal strings hardcoded in the workflow files,
not a GitHub Actions Variable or Secret at all** — `https://api-dev.anagrabble.com`/
`wss://api-dev.anagrabble.com` in `ci.yml`, `https://api.anagrabble.com`/
`wss://api.anagrabble.com` in `deploy-production.yml`. Both hostnames are
already the established, stable backend origins (see README's environments
table), not values that vary or need rotating — the indirection through a
repo Variable would have bought nothing for a value that's already public
knowledge and effectively permanent per environment. `CLERK_PUBLISHABLE_KEY`
stays as a GitHub Actions **Variable** (`CLERK_PUBLISHABLE_KEY_DEV`/`_PROD`),
not a Secret: it ends up readable in the shipped bundle regardless
(view-source away) — Clerk's own docs describe the publishable key as safe
to expose client-side — and it genuinely does vary per Clerk application/
environment, unlike the URLs, so it still warrants being configurable
without a code change. GitHub Secrets are masked in logs and write-only in
the UI, friction bought for a confidentiality guarantee this value doesn't
need. `RAILWAY_TOKEN_*`, `CLOUDFLARE_API_TOKEN`, etc. stay Secrets — those
really do need to stay confidential. Not done as part of this change:
creating `CLERK_PUBLISHABLE_KEY_DEV`/`_PROD` as repo Variables from the
values the old `VITE_CLERK_PUBLISHABLE_KEY_DEV`/`_PROD` Secrets held, and
deleting those old Secrets along with the now-entirely-unused
`VITE_API_URL_*`/`VITE_WS_URL_*` ones — manual, dashboard-side (or `gh
variable set`), not something this change can do unattended since it
requires the actual values.

**Why a `<script>` tag over a dynamic `import()`/`fetch()` awaited in
`main.tsx`** (the mechanism originally sketched when Cloudflare was still
being evaluated — see "Evaluating Cloudflare Pages for frontend hosting"):
a classic (non-`module`) `<script src="/env.js">` is discovered and fetched
by the HTML parser in parallel with the module bundle, and since
`<script type="module">` is deferred by spec, `window.__ENV__` is
guaranteed to exist before any module script runs — no `await` needed
anywhere in `main.tsx`, no async boot path, no separate error-handling
story for a config fetch failing. A dynamic `import()`/`fetch()` inside
`main.tsx` can only fire after the bundle has already loaded and started
executing, making it a genuine serial waterfall (bundle load → then fetch
config → then render) instead of a parallel one. Static `import` isn't
viable at all here — Vite would try to resolve `/env.js` at build time and
fail, since the file doesn't exist until CI generates it after the build.

**One throw-if-unset check, not four**: `src/env.ts` centralizes the
"missing config" error that each of the four `import.meta.env.VITE_*` call
sites used to duplicate. `API_URL`/`WS_URL` are exported as eager top-level
consts (matching the original per-call-site behavior — they already threw
at each importing module's first evaluation). `CLERK_PUBLISHABLE_KEY`
can't be: `clerkAuth.tsx`'s module is imported unconditionally by
`auth/index.tsx` even in mock-auth mode, where the key is legitimately
unset, so it's exposed as `requireClerkPublishableKey()`, a function called
only inside `AuthProvider`'s render — the same lazy timing the original
code already had, just centralized.

**Local dev**: `apps/web/public/env.js` (gitignored) mirrors the
`.env`/`.env.example` split — `public/env.example.js` is the checked-in
template. Vite serves `public/` files verbatim in dev and copies them
into `dist/` on build, so no code change was needed for local dev to pick
this up; CI's stamp step simply overwrites the copied `dist/env.js` before
deploy. The Vitest suite has no `<script>` tag to load, so
`vitest.setup.ts` stubs `window.__ENV__` directly (replacing the
`test.env`-based `VITE_WS_URL`/`VITE_API_URL` stub it used before).

**Implementation gotcha worth remembering**: a global type augmentation
file (`declare global { interface Window { __ENV__: ... } }`) must not
share a basename with a same-directory `.ts` file — TypeScript silently
drops a `foo.d.ts` sitting next to `foo.ts` from the program (treats them
as the same module slot) rather than erroring, so the augmentation never
takes effect and every `window.__ENV__` access fails to typecheck with no
obvious cause. Named `src/globalEnv.d.ts` (not `src/env.d.ts`) to avoid
colliding with `src/env.ts`.

---

## Game rules

### Tile turning vs. word stealing are different concurrency problems

Confirmed against the actual Claude Design prototype logic: only the current
player (rotating index) may turn a tile, gated by a per-turn countdown. This is
effectively single-writer by construction. Word submission/stealing, by contrast,
is genuinely free-for-all — any player, any time — and is the actual race the
Redis/Lua atomicity design exists to resolve.

### Turn timer enforcement: client-triggered only for MVP

**Decision (superseded — see "Turn-timer polling sweep" below)**: any
connected client fires `TurnTile` when its local countdown hits zero; the
Lua script verifies the deadline server-side regardless of who called it.
No server-side polling sweep for MVP.

**Alternative considered**: a Redis sorted-set sweep, independently polled by
every Node instance (`ZRANGEBYSCORE` against a deadlines set) — rejected for now
as unnecessary machinery at current scale (a handful of players, presumably
attentive). Explicitly _not_ rejected as an approach — it's a clean fit later,
requires no redesign (converges on the same idempotent `apply_turn_tile` call),
just deferred until real evidence (actually-stalled games) justifies it.
**Also explicitly rejected**: Redis keyspace notifications — pub/sub is
fire-and-forget; a notification with no subscriber connected at that instant is
lost permanently, which is a worse reliability property than either alternative.

### Turn-timer polling sweep

**Decision (2026-08-25, anagrabble#2)**: built the sorted-set sweep the
alternative above anticipated, replacing client-triggered-only. Picked up
directly rather than left deferred further — Stuart's call when the issue
came up, not driven by a specific stalled-game incident; the "wait for real
evidence" bar from the original decision was explicitly reconsidered and
judged not worth waiting on longer, since the sweep was always understood to
be a clean, no-redesign addition once built.

**Implementation**:

- `apps/server/src/gameSession.ts`'s `TURN_DEADLINES_KEY`
  (`games:turnDeadlines`) — a single cross-game sorted set, member = gameId,
  score = the earliest ms-epoch timestamp that game next needs the sweep's
  attention (see "Presence-aware scoring" below for what that score
  actually is). Deliberately _not_ hash-tagged like a game's own keys
  (docs/redis-schema.md "Keys") — it's an index over every game, not one
  game's state.
- Kept in sync from Node (`syncTurnDeadlineTracking`), called after every
  mutation that can change `turnDeadline`/`turnPlayerId`
  (StartGame/TurnTile/SubmitWord/EndGame) and after every presence update
  that touches the current player specifically — deliberately _not_
  maintained from inside `apply_turn_tile.lua`/`apply_submit_word.lua`
  themselves, to keep those scripts scoped to one game's own hash-tagged
  keys (see "Word resolution implementation split"'s "keeps the Lua script
  small/auditable" reasoning — same principle applied here). This means
  tracking updates aren't atomic with the state mutation, but that's fine:
  the set is a work queue, not authoritative — a stale or missing entry is
  harmless, since the sweep's actual mutation still goes through
  `apply_turn_tile.lua`'s ordinary atomic re-verification, same as any
  other `TurnTile` caller.
- `apps/server/src/turnTimerSweep.ts` — `setInterval` (1s) on every Node
  instance, `ZRANGEBYSCORE games:turnDeadlines -inf now` for due games,
  replaying `TurnTile` for each via a non-overlapping-tick guard (skips a
  tick if the previous one is still catching up, rather than piling up
  concurrent runs).
- Runs independently per Node instance rather than a single elected leader —
  deliberately not worth the added coordination machinery (leader election,
  a lock) at current scale. Safe because the sweep never claims a specific
  player identity (a fixed non-player sentinel actor id): concurrent sweep
  calls across instances can only ever succeed via
  `apply_turn_tile.lua`'s `deadlinePassed` branch, never `isCurrentPlayer`,
  which is exactly what makes the double-tile-draw bug below structurally
  impossible for the sweep to reproduce (verified by
  `applyTurnTile.test.ts`'s "draws exactly once in a two-player game when
  two sweep instances race the same missed deadline" and
  `turnTimerSweep.test.ts`'s equivalent end-to-end case) — no leader
  election needed to keep sweeps from double-drawing.
- Client-side: `useTurnTimer.ts` is now a pure countdown display with
  nothing to send — considered, and rejected, restoring a narrow
  current-player-only auto-fire purely to shave the sweep's up-to-~1s
  latency off the common "current player is actively connected but doesn't
  click" case. Would have been safe (a real client can only ever satisfy
  `isCurrentPlayer` as itself, so it can't reproduce the old
  identity-collision bug below), but Stuart judged the added code path not
  worth it against the sweep's uniform, simpler one-mechanism design at
  current scale. Revisit if ~1s of added latency on a missed deadline ever
  becomes a real complaint.

**Presence-aware scoring (disconnected-player fast-skip)**: caught in review
before this shipped — a sweep indexed purely by `turnDeadline` never
notices a current player going unreachable mid-turn. CLAUDE.md's
"Disconnected-player fast-skip" is a separate, already-existing feature
(`apply_turn_tile.lua`'s `currentPlayerUnreachable` branch accepts a
force-advance before the nominal deadline once the current player is
stale) that the old client-triggered design served via literally any
connected client's local timer effect checking presence directly. A
deadline-only sweep would have silently made that feature unreachable in
practice: it wouldn't even look at a game until the full `turnTimerSec`
had elapsed, regardless of how long the current player had actually been
gone.

**Fix**: the tracked score is `min(turnDeadline, currentPlayer's presence
deadline)`, where "presence deadline" is `lastSeenAt + PRESENCE_STALE_MS` —
the same `now - lastSeenAt < PRESENCE_STALE_MS` boundary
(`gameSession.ts`'s `isReachable`) that `apply_turn_tile.lua`'s
`currentPlayerUnreachable` check and the frontend's greyed-out/
"Disconnected" display already use, just expressed as a future timestamp
instead of a live now-vs-lastSeenAt comparison. That's what lets it sit in
the same deadline-indexed sorted set as `turnDeadline`, so the sweep itself
needs zero changes — still one `ZRANGEBYSCORE` per tick, no scanning, no
second poll loop. `syncTurnDeadlineTracking` gets called (in addition to
the mutation sites above) from every place presence actually changes for
the _current_ player specifically — `wsConnection.ts`'s `Ping` handler and
reconnect-handshake stamp, and `broadcast.ts`'s `markDisconnected` — each
already has the resulting `state` from `applyPresence` in hand, and skips
the extra `ZADD` entirely when the affected player isn't the current one.
Cost is proportional to real activity (current-player heartbeats and
moves), not to concurrent game count — deliberately rejected: scanning
every tracked game every tick to re-check presence, which would have been
O(games) per tick regardless of how many actually needed attention, not
worth it "for lots of concurrent games" per Stuart.

Because the tracked score is only ever a "when to bother checking" hint —
`apply_turn_tile.lua` still re-derives both `deadlinePassed` and
`currentPlayerUnreachable` fresh from live state at call time, same as
before — there's no way for the sweep to skip someone the UI still shows
connected: both derive from the same `lastSeenAt`/`PRESENCE_STALE_MS`
inputs, so crossing the threshold is what makes a player read as
disconnected everywhere at once. The only asymmetry is display cadence
(each viewer's own next Ping/Pong refreshes their view of others'
presence, vs. the sweep's fixed 1s tick), so the greyed-out UI can appear
up to ~1s before the sweep actually force-skips, never the reverse. Ping
failure tolerance is unaffected and pre-existing: `PING_INTERVAL_MS`
(3000ms) vs. `PRESENCE_STALE_MS` (10000ms) means roughly 3 heartbeat
attempts fit inside the staleness window before anything treats a player
as gone — a single dropped ping is a non-event, by the same time-window
mechanism (not a retry counter) that already governed `isReachable`.
Regression test: `turnTimerSweep.test.ts`'s "fast-skips a turn once the
current player goes stale, well before the nominal turnDeadline"; the
wiring at each presence call site is covered by `server.test.ts`'s "turn-
timer sweep tracking follows presence" (verifies both that the current
player's Ping/close updates tracking, and that a non-current player's
doesn't).

**Removed alongside this**, since the race they existed to guard against
(multiple _client-identity-claiming_ callers racing the same expired
deadline) can't happen once the sweep is the sole non-manual caller — see
"Two-player double-tile-draw bug" below for why this is safe even with every
Node instance running its own independent sweep: `TurnTileCommand.observedTurnDeadline`
(`packages/protocol`), the matching guard block in `apply_turn_tile.lua`,
its `ApplyTurnTileArgs`/Lua `ARGV` plumbing (`packages/redis`), and the
background auto-fire `useEffect` that lived in `useTurnTimer.ts`
(`apps/web`) — that hook is now a pure countdown display, with nothing left
to send.

### Solo-game turn nulling

**Bug**: caught by Stuart testing a one-player game — leave it, come back,
and the board shows "Someone's turn" with no button to click, until a tile
silently turns over on its own and it resolves.

**Root cause**: `apply_turn_tile.lua` used to commit to a mutation (LPOP a
tile, bump `seq`, reset `turnDeadline`) _before_ checking whether there was
actually anyone reachable to hand the turn to — it computed the "next
player" walk last, and fell back to `state.turnPlayerId = cjson.null` if
the walk found nobody. In a solo game, `turnPlayerId` is always your own
id, so leaving makes you — the only entry the walk ever considers —
unreachable, and the fast-skip fires precisely because you're unreachable.
The walk therefore always finds nobody, nulls `turnPlayerId`, and burns a
tile for it. `GameBoard`'s `game.players.find(p => p.id ===
game.turnPlayerId)` then finds nothing (no player has id `null`), so
`currentPlayer` is `undefined` and the UI falls back to "Someone's turn"
with `isCurrentPlayer` false too — no button at all. It "self-heals"
because a null `turnPlayerId` makes `currentPlayerUnreachable`
unconditionally true (see `apply_turn_tile.lua`), so the tracked score
stays "due"; once you reconnect, the _next_ sweep pass (up to
`PRESENCE_STALE_MS` later) finds you reachable and reassigns the turn —
i.e. what looked like "a tile turns over" was actually two unrequested
tiles drawn in the background, not one.

This existed in the walk-forward logic before the turn-timer sweep landed,
but was effectively unreachable in practice: the old client-triggered
design needed _some other connected client_ to fire `TurnTile` while the
current player was unreachable, which can't happen in a solo game (there's
no one else to fire it) or, in a multiplayer game, only in the fully
pathological case of every single player being disconnected at once — rare
enough nobody hit it. The sweep changed that: it can fire with _zero_
connected clients, which makes "the sole/all remaining player is
unreachable" the normal case for anyone testing or playing solo, not an
edge case.

**Fix**: moved the "who's next" walk to run _before_ any mutation, and
made "nobody reachable" a no-op — same pattern as the script's other no-op
branches (empty bank, already-seen command) — instead of committing to a
tile draw and a null `turnPlayerId`. `state.turnPlayerId` can no longer
become `null` through this path at all now; the wire type stays nullable
only for defensively rendering any already-persisted state from before
this fix. Regression tests: `applyTurnTile.test.ts`'s "is a no-op in a solo
game once the only player has gone stale" and "...when every player is
unreachable, the fully pathological multiplayer case."

### Sweep-tracking writes are fire-and-forget, not on the gameplay critical path

**Bug**: caught by Stuart noticing normal gameplay (clicking "turn a tile",
submitting a word) felt slower after the sweep landed. Confirmed by
tracing the code, not just suspicion: `turnTile`/`submitWord`/`startGame`
in `game.ts` each `await`ed `syncTurnDeadlineTracking` (a `ZADD`/`ZREM`
against `games:turnDeadlines`) _after_ the actual gameplay mutation and
_before_ returning a response — a second, real Redis round-trip on every
one of these commands that didn't exist before the sweep. Measured against
local dev Redis: ~0.2ms extra, imperceptible on localhost, but genuinely
doubling the number of round-trips these commands make; against a real
network hop to a hosted Redis this would compound meaningfully.

**Why it was unnecessary**: the tracked score was already documented (see
"Turn-timer polling sweep" above) as "a work queue, not authoritative
state... a stale or missing entry is harmless." There is no correctness
reason a client's response has to wait for that write to land — the same
reasoning already applied to the Postgres durable-history writes in
`wsConnection.ts` (`insertGame`/`insertWordPlay`, "never on the critical
path of resolving a race").

**Fix, first pass**: a generic `trackSweepAsync(promise, gameId)` helper —
fire a given promise, log on failure. Rejected on review (Stuart): a call
site couldn't tell what it was firing without reading the wrapped
expression, and nothing stopped some future unrelated promise being routed
through the same generic wrapper. Kept `syncTurnDeadlineTracking` itself
`async`/awaitable underneath it, on the reasoning that _something_ should
be able to wait for it deterministically.

**Fix, actual**: pushed on "what actually needs to await this?" and the
honest answer was nothing in production — every real call site
(`game.ts`'s `turnTile`/`submitWord`/`startGame`/`endGame`,
`wsConnection.ts`'s `Ping` handler and reconnect stamp, `broadcast.ts`'s
`markDisconnected`) only ever fired it and moved on. The one place that
looked like it needed to await it was `turnTimerSweep.test.ts`'s test
setup — but what that test actually needed wasn't "wait for the write,"
it was "the real score formula, not a re-derived one, so a regression in
the formula fails this test." Those are different needs. Split
`gameSession.ts`'s `syncTurnDeadlineTracking` into `computeSweepDueAt`, a
pure function (`GameState` → the score, or `null`) with no Redis
dependency and nothing to await, and made `syncTurnDeadlineTracking`
itself unconditionally fire-and-forget — no awaitable variant exists at
all now, so there's no "which one do I call" decision at any call site.
It and the companion `untrackTurnDeadline` both return `void`, not
`Promise<void>`, specifically so a call site can't accidentally end up
awaiting (and thus blocking on) either by construction, not just by
convention. `turnTimerSweep.test.ts` now calls `computeSweepDueAt`
directly and does its own `zAdd` for deterministic setup — still exercises
the real formula, still fails if it drifts, no dependency on the write
function's timing at all.

No test changes were needed beyond an `afterAll` grace period (same
pattern already used in `server.test.ts`/`turnTimerSweep.test.ts`, to
avoid a benign "Disconnects client" log if a fire-and-forget write is
still in flight at teardown): the existing tracking-assertion tests in
`game.test.ts`/`server.test.ts` already pass deterministically, because
they share a single Redis connection with the code under test, and a
command issued synchronously (even without awaiting its promise) is still
written to that connection's socket, and therefore processed by Redis,
before any later command issued on the same connection — this doesn't
hold across different connections (e.g. the sweep on another Node
instance), which is exactly the staleness the tracking design already
tolerates.

### Two-player double-tile-draw bug: `observedTurnDeadline` staleness guard (removed)

**Bug**: in a two-player game, every timer expiry drew two tiles instead of
one. Root cause: the client-triggered pattern above has _every_ connected
client fire `TurnTile` once the shared deadline passes, not just the current
player's client (this is what lets a fast-skip happen even if the current
player's own tab is dead). `apply_turn_tile.lua`'s guard is `isCurrentPlayer
OR deadlinePassed` — sufficient with 3+ players, where a losing racer's stale
call still fails `isCurrentPlayer` against whoever the turn _actually_
advanced to. With exactly two players there is only one other player, so the
loser's stale call is _always_ processed after `turnPlayerId` has already
flipped onto them — making `isCurrentPlayer` trivially true for the wrong
reason, and drawing a second tile.

**Fix**: `TurnTileCommand.observedTurnDeadline` (optional, additive per
"Schema evolution" in CLAUDE.md) — set only by the background auto-fire
effect (`GameBoard.tsx`) to the `turnDeadline` it observed when deciding to
fire, never by the manual "turn a tile" click. `apply_turn_tile.lua` rejects
a call whose `observedTurnDeadline` no longer matches the state's current
`turnDeadline`, regardless of `isCurrentPlayer` — i.e. "something else
already handled the deadline I was reacting to." Regression test:
`packages/redis/src/applyTurnTile.test.ts` "draws exactly once in a
two-player game when both the current player's own auto-fire and the other
client's redundant fast-skip fire for the same missed deadline."

**Removed 2026-08-25, alongside "Turn-timer polling sweep" above.** This was
scaffolding for the client-triggered era only: the race it guarded
against — multiple _client-identity-claiming_ callers independently racing
the same shared deadline — can't happen once the sweep is the sole
non-manual caller, even running independently on every Node instance with
no coordination between them. The mechanism that made the two-player case
specifically dangerous was a real client's stale call landing just after
`turnPlayerId` flipped onto _that exact browser's own player_, satisfying
`isCurrentPlayer` for the wrong reason. The sweep never claims a specific
player identity, so it can only ever succeed via the `deadlinePassed`
branch — a second, third, concurrent sweep call (from this or another Node
instance) always re-reads state past the first one's atomic mutation, sees
a fresh future `turnDeadline`, and safely fails both `isCurrentPlayer` and
`deadlinePassed`. Verified directly: `applyTurnTile.test.ts`'s "draws
exactly once in a two-player game when two sweep instances race the same
missed deadline" replaces the old client-identity version of this test.

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
  no cross-platform ordering guarantee for a single commit touching both. Gating
  both platforms' deploys on CI passing (see "Deploy gating: Railway/Vercel wait
  for CI" above) closes the _red-build-reaches-prod_ case but not this one —
  Railway and Vercel are still two independent deploy jobs for the same passing
  commit, so the constraint stays pushed into how protocol changes are written:
  additive-only per PR, with genuine breaking changes split into an "expand"
  rollout (backend tolerates old + new) followed by a later "contract" rollout.
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
  — that path is stats/audit history for after a game ends, not a
  reconstruction source for live Redis state (a Redis node dying is purely
  Redis's own HA/persistence concern — Sentinel/cluster, still undecided per
  "Redis hosting" below — and Postgres plays no role in it, deliberately);
  this is an ephemeral, per-viewer narration convenience with no
  bearing on correctness. **Update (2026-08-17)**: `history` is now
  `HistoryEntry[]` (`WordPlayNarration` rows plus a `PlayerJoinedHistoryEntry`
  row), narrating a player joining the game — pulled straight from the real
  `PlayerJoined` event, no new client logic beyond adding it to the array.
  Connect/disconnect/reconnect narration was considered and deliberately
  left out (not deferred): those aren't discrete server events at all
  (presence writes don't bump `seq` or broadcast on their own — see
  docs/redis-schema.md "Presence"), so showing them here would mean
  client-side diffing of `players[].presence` across consecutive
  snapshots — judged not worth the complexity and, per Stuart, likely to
  read as noisy given how often presence flips in practice (a laptop lid
  closing, a flaky mobile connection). "Joined" needed none of that, since
  it already rides a real one-time event.
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

**Correction** (2026-08-12): two details in the "Decision" paragraph above
are now stale, both superseded by changes documented elsewhere in this
file. The `New Game → Lobby` half of the motivating example no longer
applies — `CreateGame` moved off WS onto `POST /games` (see "CreateGame as
a REST endpoint" below), so `NewGamePage` doesn't hold a WebSocket at all
anymore; there's no create-page socket to close during that transition.
And `?player=` was removed from the WS connect URL entirely (see "Command
identity: derived from the Clerk session, not client-supplied" —
"Deferred, now landed") — reconnection is recognized purely via the
verified Clerk session token checked against the game's existing player
list, no query param involved. `pendingLeaves`/`LEAVE_GRACE_MS` itself is
still very much live, but only pre-start: `leaveGame()` (`lobby.ts`) is a
no-op once `status !== "lobby"`, so a mid-game drop was never going to
remove anyone from `players` regardless of this window — score and
claimed words just sit untouched while a player's gone. What it actually
guards is a pre-start player (worst case the host, since host is derived
from `players[0]`) getting visibly bounced from the lobby's player list
and having to re-join at the back of the queue on a reload or blip. The
reconnect-with-backoff feature (see "Reconnect-with-backoff: scope calls
made, not blockers") is what makes that recovery fast enough to matter for
this specific case — its first retry attempt (1s) is deliberately inside
this 3s window. See "Explicitly still open" below for the host-status
follow-up this raised.

**Superseded** (2026-08-15): `pendingLeaves`/`LEAVE_GRACE_MS` removed
entirely, along with the "known limitation" above — see "Player presence:
connected/disconnected tracking" below for the replacement (a
heartbeat-driven `lastSeenAt` per player, derived reachability, no
scheduled timers anywhere). The single-process gap this section flagged is
resolved as a side effect, not worked around: presence now lives in Redis,
readable/writable by any node, so there's nothing left that only one
process knows about.

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

**Known gap, largely addressed 2026-08-12**: the source data's root annotations
were incomplete/inconsistent (e.g. `abaser` had no recorded root, though it
plausibly derives from `abase`) — noted by Stuart as a known limitation of the
POC dictionary. See "Root-word enrichment: WordNet + Wiktionary" below for the
fix. ~34,815 of the ~133,260 previously-blank roots now have one; the
remainder are either genuine root words (correctly blank) or words neither
source had etymology data for.

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

### Root-word enrichment: WordNet + Wiktionary

**Decision**: fill the gap above with two layered, rerunnable scripts rather
than a better stemmer — `packages/game/scripts/fetch-wordnet-roots.mjs`
(Princeton WordNet 3.0's explicit "derivationally related form" pointers,
e.g. ABASE↔ABASEMENT — a curated relation, not a guess) and
`fetch-wiktionary-roots.mjs` (Wiktionary's etymology data via the
Wiktextract/kaikki.org structured dump, needed because WordNet's ~155k-word
vocabulary is smaller than this dictionary's ~279k and simply doesn't contain
many Scrabble-legal words at all — e.g. ABASER isn't in WordNet). Both write
a candidate `(word, root)` CSV to `packages/game/data/generated/`;
`merge-dictionary-roots.mjs` then applies them to
`data/dictionary-source.csv` in that priority order (WordNet first), only
ever filling a currently-blank root, never overwriting existing data — so
reviewing a rerun is just a normal `git diff`, and the change is naturally
bounded no matter how the upstream sources drift. `pnpm enrich:dictionary`
runs the whole chain (both fetches, the merge, and the existing
`build:dictionary` flatten). Not run on any schedule — re-run by hand
whenever there's reason to think WordNet/Wiktionary have improved, per
Stuart: regenerating this file is invasive enough that it doesn't want a
cadence, just the tooling to do it on demand.

**Measured results** (2026-08-12 run): WordNet filled 7,068 of the then
133,260 blank roots; Wiktionary filled a further 27,747 that WordNet's
smaller vocabulary missed (33,397 raw Wiktionary candidates, minus overlap
with what WordNet already filled). 31 candidates were found and discarded by
validation (root not itself a claimable dictionary word, or not a valid
prefix relationship). Both pipelines were spot-checked against known-bad
control pairs (e.g. `danger`/`dang`, `aspic`/`asp` — coincidental letter
overlap, not real derivations) with zero false positives before being
trusted at full scale.

**A real bug found and fixed along the way**: the first Wiktionary pass
(49,684 raw candidates) wrongly picked short _prefix_ fragments as roots
whenever they happened to also be valid standalone words — e.g. it recorded
`abactinal,ab` and `unhappy,un`, because "is a literal string prefix" (the
existing suffix-derivation convention's whole test) can't distinguish "AB is
the root, -ACTINAL is a suffix" (false) from "AB- is a prefix, ACTINAL is the
real root" (true, and irrelevant here since ACTINAL isn't a literal prefix of
ABACTINAL either way). Left unfixed, this would have wrongly blocked
extending a short word like AB into a much longer one as a "trivial"
derivation extension. Fixed in `scripts/lib/wiktionary-parse.mjs` by reading
the affix _role_ Wiktionary's own data already encodes — arg position for
named `prefix`/`pre` templates, hyphen position (`"un-"` vs `"-er"`) for the
generic `affix`/`ety` templates — and never treating a piece marked as a
prefix as a root candidate. This dropped the Wiktionary candidate count from
49,684 to the 33,397 above. WordNet's data isn't susceptible to the same
failure mode: its "+" pointers link two independently-headworded lemmas, not
affixes Wiktionary documents as pseudo-words.

**A real gameplay consequence, not just a data nicety**: filling in a root
for a genuine compound (e.g. `catnap,cat`) means a previously-legal play can
become illegal — combining claimed words CAT + NAP into CATNAP is now
correctly rejected as `DerivationBlocked`, per the existing "however the
extra letters would be sourced" rule (CLAUDE.md "Word formability"), because
CATNAP is now correctly known to be CAT's derivative. This isn't a bug in
the enrichment; it's the already-designed blocking rule finally able to fire
because the data it depends on is more complete. `resolution.test.ts`'s
"combining multiple claimed words" fixtures moved off CAT/NAP (which
happened to only work because of the data gap) onto ARM + SET → MASTER,
chosen because it combines via a genuine letter-multiset anagram rather than
literal concatenation, so neither claimed word can ever become a recorded
prefix-root of the result.

**Chain-flattening (`build-dictionary.mjs`) is more load-bearing after this,
not less** — checked directly rather than assumed, since it would have been
reasonable to guess two independently-computed root layers might only ever
add single, terminal hops. They don't: 38,040 words now have a root whose own
root is itself further recorded (up from the "max chain depth 2 hops, 0
cycles" verified for the original data), and max chain depth is now 5
(`editorializers → editorializer → editorialize → editorial → editor →
edit`, a genuine, correct chain). More significantly, the enrichment
surfaced one real **cycle**: the original data already had `neuroptera`
(the taxonomic order) listed with root `neuropteran` (backwards — the real
etymology is the reverse, `neuropteran` = `neuroptera` + `-an`), harmless
before only because `neuropteran`'s root was blank so the chain dead-ended.
Wiktionary correctly found and filled `neuropteran,neuroptera`, which turned
the pre-existing backwards entry into an actual 2-cycle. Fixed by blanking
the erroneous original `neuroptera,neuropteran` entry (verified: 0 cycles
across the whole dictionary afterward). `build-dictionary.mjs`'s existing
cycle guard (`if (seen.has(next)) break`) meant this was never a crash or
hang risk, just a wrong/arbitrary resolved root for whichever word the walk
happened to bail out on - worth knowing that a future rerun could in
principle reintroduce a similar case if the source data has other
undiscovered backwards entries; the merge pipeline validates each candidate
in isolation and has no cross-candidate cycle check.

**Sources considered and rejected**: Wikidata's Lexeme data groups inflected
forms (CATS under the same lexeme as CAT) cleanly, but — checked directly
against its `abase` lexeme — records no derivational link at all to
`abasement`/`abaser`; it's solved-already inflection, not the derivation gap
this addresses. NLTK's Morphy and spaCy's lemmatizer are likewise
inflection-only (cats→cat, ran→run) — checked against the existing data and
those relations were already mostly present — and applying either to
_derivational_ morphology (the actual gap) produces false positives the same
shape as a naive suffix-stripper (e.g. `danger`→`dang`). A GitHub mirror of
the official TWL06/Collins Scrabble Words tournament lists
(`kaikki.org/dictionary/English` via `kamilmielnik/scrabble-dictionaries`)
was also evaluated for the _word-validity_ half of the dictionary (a
separate question from roots) — turned out largely moot, since the existing
word list already matches SOWPODS/Collins to within ~12k words of edition
drift; refreshing it against a current Collins edition remains a deferred,
lower-priority follow-up (Stuart: "feel free to defer" if the root work was
more valuable, which it was).

**Licensing, scoped precisely**: WordNet's license is simple and
permissive — free commercial use and redistribution, provided its copyright
notice is retained (not a copyleft/share-alike obligation). Wiktionary
(via Wiktextract) is CC BY-SA 4.0, which _is_ share-alike — but that
obligation is scoped to `data/generated/wiktionary-roots.csv` and its
contribution to `dictionary-source.csv`, not the rest of the codebase:
Creative Commons' share-alike only propagates within an adapted work itself,
not to independently-authored code merely bundled alongside it (CC's
"collection" vs. "adaptation" distinction), and a bare `(word, root)` fact
pair arguably isn't copyrightable expression in the first place (facts
aren't protectable; only original expression is — the same reasoning that
lets word-game word _lists_ be freely extracted from copyrighted
dictionaries). Not a substitute for real legal advice if this becomes
commercially significant; no NOTICE/THIRD_PARTY file exists in this repo yet
to formalize the attribution — worth adding before wider distribution, not
done here since nothing currently requires it.

**Alternatives considered**:

- **A better stemmer instead of curated relation data** — rejected: stemmers
  (Porter, Snowball, Morphy/lemmatizers) target search/IR use cases and
  conventionally only handle inflectional morphology; pointed at
  derivational morphology (the actual gap) they produce false positives
  (`danger`→`dang`) with no way to distinguish a real relation from
  coincidental letter overlap. Curated relation data (WordNet's pointers,
  Wiktionary's etymology templates) encodes that a source editor asserted
  the relationship is real.
- **Trusting the "candidate root" without validating it's itself a claimable
  dictionary word** — rejected: the game's `isDerivedFrom` check only makes
  sense against a word players could actually have claimed; a root absent
  from the dictionary would create a derivation rule referencing an
  unclaimable word, an incoherent state. `merge-dictionary-roots.mjs`
  validates this explicitly (31 candidates dropped for exactly this in the
  2026-08-12 run).
- **Overwriting existing (possibly-wrong) roots when a source disagrees** —
  rejected: only 8 words in WordNet's output disagreed with existing data at
  all (and those turned out to be same-answer, different chain-hop-depth,
  not real conflicts — see `scripts/lib/merge-roots.mjs`'s fill-blanks-only
  design), and silently overwriting curated/reviewed data on every rerun
  would make the diff on a rerun unpredictable instead of strictly additive.

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
`meta.clerkUserId` on the socket — see `src/index.ts`. This was originally
landed as pure plumbing: no command was gated on it, and nothing linked a
game/player to `clerkUserId`. **Superseded by "Command identity: derived
from the Clerk session, not client-supplied" below** — every
identity-bearing command is now gated on it.

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

## Command identity: derived from the Clerk session, not client-supplied

**Decision**: every identity-bearing command (`CreateGame`'s `hostId`,
`JoinGame`'s `playerId`, `StartGame`'s `hostId`, `TurnTile`'s `playerId`,
`SubmitWord`'s `playerId`) no longer trusts the id in the command payload.
`apps/server/src/index.ts` resolves the actual actor via
`resolveActingPlayerId` (`src/auth.ts`) — the verified `meta.clerkUserId` on
the connection, or `null` if this connection never verified a session — and
substitutes it before calling into `lobby.ts`/`game.ts`, ignoring whatever
the client claimed. A `null` result rejects the command with a new
`Unauthorized` error code rather than falling through to any trust-the-client
path. The same substitution applies to the `?player=` reconnect check on WS
connect.

**Why derive instead of verify-and-compare**: the alternative — keep trusting
the payload id but reject if it doesn't match `meta.clerkUserId` — still
leaves the payload field meaningful and requires a comparison at every call
site. Since `apps/web` already only ever sends the signed-in user's own
Clerk id (`useAuth().userId`) in these fields, there was never a legitimate
case where the payload id should differ from the verified session id.
Deriving instead of comparing collapses that to "there's nothing left to
verify." This landed in two rollouts (see "Deferred, now landed" below):
first the field went vestigial (server ignores it but the wire shape didn't
change), then a follow-up removed it from the wire entirely.

**A connection race had to be fixed first**: token verification
(`verifySessionToken`) is async, but the WS `message` listener used to be
registered without waiting for it — a command could arrive and be processed
before `meta.clerkUserId` was set, making even a verify-and-compare check
racy. Every command handler now `await`s a shared `identityReady` promise
before resolving identity, without needing to delay registering the
`message` listener itself (which would risk dropping messages sent
immediately after connect).

**`CLERK_SECRET_KEY` is now required, not optional**: previously documented
(here and in `apps/server/.env.example`/`README.md`) as fine to leave unset
for local dev — "the backend runs fine without it, it just can't verify a
signed-in session." That fallback is removed, not just unused: an unset key
now means `resolveActingPlayerId` always returns `null`, so no
identity-bearing command can succeed. This is a deliberate policy change
(not merely following from the code above) — the frontend has required real
Clerk sign-in for all gameplay since "Player identity: Clerk id, no
anonymous play" landed, so a server that tolerates no-Clerk was already out
of step with a client that can't reach it without one. Tests that need a
verified identity mock `@clerk/backend`'s `verifyToken` directly (same
pattern `auth.test.ts` already used before this change), rather than relying
on a server-side no-auth mode.

**Deferred, now landed**: removing `hostId`/`playerId` from the
`packages/protocol` command types entirely, and having `apps/web` stop
sending them, was originally deferred as its own expand/contract rollout —
now done, as a follow-up to this decision. `PROTOCOL_VERSION` bumped 1 → 2
to mark the wire shape change. Safe to ship immediately (not held for a
separate deploy window) because the expand-phase server described above was
already live on dev and already ignores these fields unconditionally, so it
tolerates old clients (extra fields, harmless) and new clients (fields
absent) identically — the only unsafe direction, a field-omitting client
talking to a pre-expand server, can't happen since that server no longer
exists anywhere. `apps/server/src/lobby.ts`'s `createGame`/`joinGame` and
`game.ts`'s `startGame`/`turnTile`/`submitWord` take the resolved actor id
as an explicit parameter now, rather than a command field — same pattern
`packages/redis`'s `applyTurnTile`/`applySubmitWord` already used (a bespoke
options object, not the raw `Command` type). The `?player=` query param
(`useGameSocket`'s former `knownPlayerId`) was removed alongside it, having
already gone dead server-side in the expand phase (the reconnect check
resolves off `meta.clerkUserId` alone).

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

## Password reset: code entry, not the design mock's magic link

**Decision**: "Forgot password?" (`LoginPage.tsx`'s third `"reset"` mode)
resets via Clerk's `reset_password_email_code` strategy — the visitor
enters their email, gets a one-time code, and enters that code alongside
their new password in the same form. On success, the flow calls
`setActive({ session: result.createdSessionId })` and redirects straight
into the app, the same as `submitLogin`/`submitVerification`.

**Why it deviates from `design-system/Log in, Sign up.dc.html`'s reset
step**: two separate deviations, for two separate reasons.

- **Code instead of a magic link.** That mock's `resetSent` state assumes
  a magic-link email ("Open reset link (demo)" — a fake link the
  localStorage demo could short-circuit). A real link-based flow needs a
  public landing route that verifies a token from the URL — a bigger
  surface than this story needs, and Clerk's documented SPA custom-flow
  API for password reset is code-based, the same shape as the sign-up
  email verification already built (`submitVerification` in
  `LoginPage.tsx`). The separate `design-system/Reset Password.dc.html`
  file — the landing page a magic link would point to — is accordingly
  not built; there's no link to land from.
- **Auto-sign-in instead of the mock's "back to log in."** First built to
  match the mock's "done" screen (skip `setActive`, send the visitor back
  to log in with their new password) — reverted after real testing showed
  this doesn't actually leave the visitor signed out. Clerk's Frontend API
  sets the real session cookie the moment `attemptFirstFactor` returns
  `status: "complete"`, independent of any `setActive` call in our code;
  skipping it only left the SPA's own `isSignedIn` state briefly stale
  (surfacing as "you're already signed in" on the log-in form, or a
  signed-in header only after a manual refresh) rather than the visitor
  actually being signed out. Given the session is created either way,
  calling `setActive` and redirecting straight in is both more correct
  (no stale-state window) and better UX — entering a one-time code mailed
  to the account is at least as strong a proof of identity as the
  password just typed into the same form, so there's no security reason
  to force a second, redundant login. The mock's "back to log in" framing
  isn't good evidence against this: it's a plausible default for a
  localStorage demo with no real concept of "a session now exists," not
  a considered security tradeoff.

---

## Home page takes over `/`; create-game form moves to `/new`

**Decision**: `HomePage` (design-system `Home.dc.html`) is now the `/`
route, public (no `RequireAuth`) since it's explicitly for visitors
"before I sign in." `NewGamePage` — previously `/` — moved to `/new`,
still gated by `RequireAuth`. Its "Create a game" button always
`navigate("/new")` regardless of sign-in state; `RequireAuth` does the
login redirect-and-return itself, so there's no need to reimplement the
design mock's client-side `createHref` branching (login vs. new-game link
depending on a fake `isLoggedIn` check) in real code.

**Why**: the user story is explicit that the home page is "distinct from
`/`, which today goes straight to the create-game form" — i.e. the
existing behavior (root = create-game form, no separate landing surface)
is the gap being fixed, not a shape to preserve. Since gameplay requires
sign-in (see "Player identity: Clerk id, no anonymous play") but the home
page must not, the two routes can't both be `/`; the create-game form had
to move. `/new` was chosen over alternatives like `/new-game` for brevity,
matching the existing single-word-ish path style (`/login`,
`/sso-callback`).

Ripple: `GameOverSummary`'s "New game" button and its test now target
`/new` instead of `/` — it means "start another game," not "go to the
marketing page." `LobbyPage`'s "Back home" (shown on `GameNotFound`)
needed no change — it already meant, and still means, the marketing home
page, matching `design-system/Join Game.dc.html`'s `Back home` → `Home.dc.html`.

Design-system's "Read the full rules →" link on `Home.dc.html` is left out
of `HomePage` for now — the standalone rules page it points to is a
separate, not-yet-built user story (see "Home & rules" in
`docs/user-stories.md`); add the link when that page exists.

## Rules modal: one consistent link, not per-page copy/alignment

**Decision**: `New Game.dc.html`, `Join Game.dc.html`, and `Lobby.dc.html`
each show a link that opens the rules as an in-place modal, but disagree
with each other on both copy ("Rules" vs. "Review the rules while you're
waiting") and alignment (left on New Game/Join Game, right on Lobby).
Rather than reproduce that inconsistency, every instance is now the same
`RulesLink` component: copy is always "Review the rules", alignment is
always left. `RulesLink` owns its own open/closed state and renders
`RulesModal` (reusing `RulesContent`, same as the standalone `/rules`
page) when open, so a page just drops in `<RulesLink />` rather than
wiring up its own modal state. Landed on `NewGamePage` and `LobbyPage` —
the latter covers both the design's Join Game and Lobby screens, since
there's no separate join page in the real app (see "Home page takes over
`/`" ripple notes and `LobbyPage`'s own header comment).

**Why**: the three design screens were never reconciled with each other
before export, and copying that drift into real code would mean a player
sees different wording/placement for the identical action depending on
which screen they're on — worse than picking either option consistently.
"Review the rules" was chosen over bare "Rules" as more descriptive of
what clicking it does; left alignment was chosen because it already
matched 2 of the 3 source screens. Encoding the decision as a shared
component (rather than a documented convention each page must remember to
follow) makes the inconsistency structurally impossible to reintroduce.

## Postgres scope: stats/audit history, not Redis recovery

**Decision**: Postgres (`docs/postgres-schema.md`) records completed, permanent
history for stats/lookup purposes only — `games`, `game_players`, `word_plays`,
`player_settings`. It is explicitly not a mechanism for reconstructing an
in-progress game if Redis is lost. Writes happen async, after Redis has
already accepted and broadcast the move, never on the critical path — matching
CLAUDE.md's original "written after Redis accepts a move, never on the
critical path" framing, now made precise about what that durability buys you
and what it doesn't.

**Alternatives considered**: a recovery-capable event log — Postgres capturing
enough per-move fidelity (full pool-state deltas, turn deadlines, commandId
dedup state) to replay and rebuild live Redis state after a crash, closer to
full event sourcing.

**Why stats-only won**: a Redis node dying is purely Redis's own
persistence/replication concern (AOF/RDB + restart-from-disk for the "process
restarted" case; Sentinel/cluster for true failover — see "Redis hosting"
above, deliberately deferred, single-instance for MVP) — the same category of
problem as the Akka clustering question early in this doc, just solved at the
infra layer rather than the application layer. Postgres was never part of
that story. Making it recovery-capable would mean giving up the "never on the
critical path" property that makes the write path cheap and simple (recovery
needs strong write guarantees; stats/audit doesn't), for a scenario — genuine
Redis data loss, not just a restart — judged rare enough at MVP scale (single
Redis instance, few concurrent games) not to engineer around yet. An
in-progress game not surviving that scenario is an accepted gap, revisit only
if real usage makes it a real cost.

**Raised by**: a sentence in this doc's older "History panel is client-side
only" entry incorrectly implied Postgres already played this role — corrected
alongside this entry landing.

## `word_plays`, not a generic `game_events` table

**Decision**: the durable per-move log (`docs/postgres-schema.md`) is named
and shaped around word plays specifically — `word_plays`, columns for `word`,
`clerk_user_id`, `used_words`, `used_pool_letters` — not a generic
`type` + `payload jsonb` events table covering every Redis event type.

**Alternatives considered**: a generic `game_events` table with a `type`
column and a jsonb `payload`, able to hold any event kind (`TileTurned`,
`PlayerJoined`, `GameStarted`, `GameEnded`, `WordPlayed`, ...) uniformly.

**Why narrowed to word plays only**: walking every other event type against
what it would actually be used for came up empty. `TileTurned` is pure
random-reveal noise — up to 144 rows per game with no stat value.
`PlayerJoined`/`PlayerLeft`/`GameStarted` are lobby-level, and whatever value
they'd have (e.g. game duration) is already covered by
`games.started_at`/`ended_at`, written at those same moments regardless.
`GameEnded` likewise adds nothing a dedicated event row would capture beyond
what `games.ended_at` and the final `game_players` rows already record at
that exact moment — a row for it would be pure duplication. What's left,
`WordPlayed`, is the one event whose detail (which prior claimed word(s) a
play consumed, via `usedWords`) is otherwise lost the instant only the final
`game_players.final_words` list survives — needed for steal counts and
word-derivation chains (e.g. CAT → CAST → CASTS → FORECASTS), see
`docs/postgres-schema.md`. With only one event type left, the `type` column
was dropped too — it protected against nothing once there's nothing else to
discriminate between. Revisit (re-adding `type`, or a specific new table) only
if a concrete future stat idea actually needs one of the excluded event
kinds — not defaulted back in speculatively.

## `packages/postgres`: Kysely for queries and migrations

**Decision**: `packages/postgres` (the typed client for the durable-history
writes in `docs/postgres-schema.md`) uses **Kysely** to build/run its
queries (`insertGame`, `endGame`, `insertWordPlay`), against the documented
schema types in `src/schema.ts`, and (as of 2026-08-11, superseding the
original pick below) Kysely's own `Migrator` to run migrations — not
Drizzle/Prisma. Migrations are still plain numbered `.sql` files in
`src/migrations/` (a custom `SqlFileMigrationProvider` in `src/migrate.ts`
reads each file and hands it to the `Migrator` as a `Migration` whose `up`
runs the raw SQL via `sql.raw(...)`) — only the runner changed, not the "a
migration is just a SQL file" property.

**History**: the first pass at this package (2026-08-11) picked plain `pg`
with no query-builder at all, reasoning by analogy from this repo's existing
minimal-tooling choices (raw `ws`, raw `http`, hand-written Lua). That
default had been flagged to the user once by an earlier thread but was
carried forward into implementation without actually being confirmed. When
asked directly, the user's answer was: compile-time query safety from day
one, yes — reused as-is, but the point of the raw-`ws`/raw-`http`/Lua
comparisons (see "Explicitly still open" below) is under separate live
question, not settled precedent this decision gets to assume — the lesson
generalizes beyond this one package: a default flagged once isn't the same
as a default confirmed.

Migrations themselves started as a hand-rolled runner (`pool.query` per
file, tracked in a `schema_migrations` table) on the same minimal-tooling
reasoning, deliberately choosing not Kysely's own migrator either at that
point. That reasoning didn't survive contact with a concrete design
question later the same day: `apps/server` needs to call `runMigrations` on
every node's startup (see "Explicitly still open" below on server-side
Postgres wiring), and with more than one node able to boot at once, two
nodes can race to apply the same not-yet-applied migration — the hand-rolled
runner had no lock, so the loser's `CREATE TABLE` would fail and crash that
node's startup. Re-examining, the original argument for avoiding Kysely's
migrator (staying consistent with the "migrations are hand-rolled SQL"
framing used to justify Kysely-the-query-builder over Drizzle/Prisma, see
below) turned out to be about schema _ownership_ — Drizzle/Prisma generate
or own the schema, which really would fight "just SQL files." Kysely's own
`Migrator` does neither: it's a runner, not a schema-ownership layer, so
using it doesn't reintroduce the thing that was actually being avoided, and
it comes with exactly the concurrency-safe locking (a `kysely_migration_lock`
table, serializing concurrent `migrateToLatest()` callers) the hand-rolled
version lacked — for free, with a dependency already in the package.

**Alternatives considered**: plain `pg` with hand-written SQL strings and a
hand-rolled migration runner (the original pick — no compile-time query
check, and no locking against concurrent migration runs, verified only by
tests); Drizzle/Prisma (heavier — schema-file codegen and/or a full
migration DSL, more than this package's 4-table surface needs, and the
schema-ownership model the "just SQL files" choice was specifically avoiding).

**Why Kysely specifically over Drizzle/Prisma**: Kysely wraps `pg` rather
than replacing it — it's a query _builder_ with full TypeScript inference
from a hand-written `Database` interface, not a schema-ownership framework.
The `Database` type in `src/schema.ts` is kept in sync with
`src/migrations/*.sql` by hand (same discipline as any other schema change);
Kysely's job (for both queries and, now, migrations) is purely making
queries against that shape fail to compile if they drift from it, and
running the SQL files that define it — not generating or owning the schema
itself. Drizzle's migration-generation and Prisma's schema-file-as-source-
of-truth model would fight that division of responsibility; Kysely's own
migrator doesn't.

## Backend HTTP framework: Fastify, not raw `http`

**Decision**: adopt Fastify for `apps/server`'s REST surface, migrating the
existing raw-`node:http` scaffold. Landed alongside `GET /stats` — the
second real REST endpoint (after `/health`), with a third (Settings,
`docs/user-stories.md`) already queued.

**Alternatives considered**: staying on raw `http` (the status quo — a
single `if (req.url === ...)` branch inside `createServer`'s callback);
Express (dated patterns, weaker native TS ergonomics); NestJS (DI/decorator
ceremony disproportionate to this project's actual complexity, which lives
in the state machine, not routing). Express/NestJS were ruled out earlier
and aren't reopened here.

**Why now, not earlier**: this was left an explicit TBD (see the old
"Explicitly still open" entry this replaces) precisely because one route
(`/health`) didn't justify a framework. A second endpoint needing real
auth/CORS/response-shape handling, with a third already in the backlog, is
the point past which hand-rolling that plumbing per-route stops being
free — `/stats` needed CORS preflight handling in particular (see "REST
endpoints beyond `/health`" below), which is where `@fastify/cors`
concretely earns its keep over hand-written header logic.

**Why this doesn't reopen `ws` vs. Socket.IO**: raw `ws` still attaches
directly to the underlying `http.Server`'s native `upgrade` event
(`new WebSocketServer({ server: fastify.server })`) — Fastify exposes that
server immediately at construction, not just after `.listen()`. Socket.IO
would attach the same way (`new Server(fastify.server)` / `io.attach(...)`),
so this migration is orthogonal to that still-open question either way; see
its own entry below.

## REST endpoints beyond `/health`: plain HTTP/JSON, not a WS command/event pair

**Decision**: `GET /stats` (and the REST surface generally) is plain
HTTP/JSON — a stateless pull — rather than a new WS `Command`/`Event` pair
routed through the existing gameplay channel.

**Why**: stats are a one-shot read with no live/real-time requirement —
round-tripping through Redis pub/sub for something that never changes
mid-request would add machinery (a command type, an event type, protocol
version bumping) for nothing the WS path is actually good at. Plain HTTP is
the right tool for "fetch this once when the page loads."

**CORS**: `apps/web` (Vercel/localhost) and `apps/server` (Railway/
localhost) are different origins, and unlike the WS path (browsers don't
apply fetch-style CORS to WebSocket handshakes), a plain `fetch()` does —
this is the first thing in the app that actually needs it. Handled via
`@fastify/cors` with a new required env var `WEB_ORIGIN` (same
required-with-throw pattern as `REDIS_URL`/`DATABASE_URL`/
`CLERK_SECRET_KEY`) — an explicit single origin, not `*`, per the intent
already flagged in "Frontend hosting: Vercel/Cloudflare Pages" above.

**Response type: originally hand-duplicated, moved to `packages/protocol`
once the Settings endpoint arrived (2026-08-12).** This entry originally
kept `PlayerStatsResponse` out of `packages/protocol`, reasoning that the
package "is scoped explicitly to the WS wire protocol, versioned via
`PROTOCOL_VERSION`... a plain GET response... shouldn't participate in that
versioning discipline" — defined once in `apps/server/src/stats.ts` and
hand-duplicated in `apps/web/src/fetchPlayerStats.ts`, revisiting "only if
a second/third HTTP endpoint makes the duplication actually hurt."

That reasoning was too broad, caught while planning the Settings feature
(`GET`/`PUT /settings`, the anticipated third endpoint): the actual reason
expand/contract exists is that backend and frontend deploy independently
with no atomicity guarantee (CLAUDE.md "Schema evolution"), which is
exactly as true of a REST response as a WS event — an old frontend can hit
a new backend's `/settings` just as easily as it can see a new
`WordPlayed` shape. What's genuinely WS-specific is only the
`PROTOCOL_VERSION` _handshake_ — a staleness check that makes sense for a
long-lived connection the server can proactively challenge at connect
time; a stateless REST call has no equivalent connection to negotiate
over, so it doesn't need a version field. The "don't drag `pg`/`kysely`
into `apps/web`" half of the original reasoning also doesn't actually
block sharing: `packages/protocol` itself has zero runtime dependencies.

**Current state**: `packages/protocol/src/rest.ts` holds
`PlayerStatsResponse`/`RecentGame`/`PlayerSettingsResponse` — plain REST
DTOs, imported by both `apps/server` and `apps/web`, explicitly excluded
from `PROTOCOL_VERSION` but still bound by the same additive-only,
no-rename/remove-in-one-PR discipline as `Command`/`Event` when they
change. A genuinely breaking REST change (the "contract" half) uses a
different mechanism than `Command`/`Event` since there's no handshake to
detect staleness with — a versioned path prefix (e.g. `/v2/settings`) or a
version header, added alongside the old route and tolerated for one
rollout before the old one is retired in a later PR. Not needed yet by
anything in this codebase; recorded now since it falls directly out of
this correction.

**`VITE_API_URL`/`VITE_WS_URL`**: added `VITE_API_URL` (new, additive) for
`apps/web`'s REST calls rather than deriving it from `VITE_WS_URL` in
either direction yet. Long-term, `VITE_API_URL` should become canonical
with the WS URL derived from it (same backend service, different scheme —
`http:`/`https:` vs `ws:`/`wss:`; two independently-set env vars that must
always agree is a real drift risk). Not done in this pass — see
"Explicitly still open" below; sequenced there rather than cut over
immediately since `VITE_WS_URL` is presumably already configured in
deployed environments.

**Both made mandatory (2026-08-11), no localhost default.** Originally
`VITE_WS_URL`/`VITE_API_URL` silently defaulted to `ws://localhost:8080`/
`http://localhost:8080` when unset, unlike `VITE_CLERK_PUBLISHABLE_KEY`
(always throw-on-startup) and every backend var (`REDIS_URL`/
`DATABASE_URL`/`CLERK_SECRET_KEY`/`WEB_ORIGIN`, same throw-on-startup
pattern). Raised by the user, who noticed the asymmetry. Changed to
throw-on-startup like the others: a deployed environment missing the var
now fails immediately and legibly at boot instead of building a bundle
that quietly points at `localhost:8080` and only fails once a WS/fetch
call is attempted at runtime. `apps/web/.env` (local dev) now sets both
explicitly rather than relying on the removed default.

**Score-over-time chart: dropped, not deferred**, and **average/highest
score kept despite the same caveat**. Raw score isn't comparable across
games with different `minWordLength` configs — CLAUDE.md's scoring formula
(1 point at `minWordLength`, +1 per letter beyond it) means a 3-letter-
minimum game scores higher than a 4-letter-minimum game for equivalent
play. A chart plotting that across a player's history makes the comparison
implicit and visual — actively misleading, not just imprecise — so it's
out entirely pending either per-config normalization or a per-ruleset
breakdown (not designed here). Average/highest score have the identical
bias but are kept anyway: they're still meaningful as "your own history
over time," just not an apples-to-apples number between players with
different game preferences — noted in code comments and
`docs/postgres-schema.md`, not silently presented as comparable.

## Settings preferences: provisioning, save behavior, language scope

Three decisions made together implementing `docs/user-stories.md`
"Settings" (`GET`/`PUT /settings`, `SettingsPage`).

**`player_settings` provisioning: lazy upsert, not a Clerk webhook.** No
row needs to exist before a player's first save; `GET /settings` returns
the table's own column defaults (`DEFAULT_PLAYER_SETTINGS` in
`packages/postgres/src/settings.ts`) when absent. The alternative
considered — a Clerk `user.created` webhook proactively inserting a
default row, with `user.deleted` cleaning it up — is more robust in the
abstract (a row always exists, no defaults-fallback logic needed) but is
real new infrastructure (a signed endpoint, per-environment Clerk
dashboard configuration) for a guarantee nothing downstream currently
needs, since `player_settings` has exactly one reader today. It also
doesn't work under local dev's `AUTH_MODE=mock` at all — there's no real
Clerk account-creation event to fire a webhook from locally, so the
webhook path would need a parallel mock-provisioning mechanism just to be
testable in dev. Revisit if a second consumer of `player_settings` ever
wants a guaranteed-row-exists invariant, or if account-deletion cleanup
becomes a real requirement.

**Save behavior: immediate persist per control, no Save button.** Matches
`design-system/Settings.dc.html`'s actual behavior for these three fields
(`persist(patch)` fires on every toggle/select change) — the mock's
separate "Save profile" button covers only name/email/password, which
this story excludes entirely (see below). Each control updates local
state immediately and fires the `PUT` right away; on failure, the specific
control reverts to its previous value and an inline error shows, rather
than a whole-page error/dirty-state model. Considered and rejected: a
single Save button batching all three fields — closer to a traditional
form, but diverges from the mock's own behavior for these controls and
adds unsaved-changes tracking to what are otherwise three independent
atomic preferences with no reason to commit together.

**Language: single-option `Select`, not a hand-picked list, and not
omitted.** Only `"English"` is accepted by the server
(`apps/server/src/settings.ts`'s `ALLOWED_LANGUAGES`) and offered by the
client (`SettingsPage.tsx`'s `LANGUAGE_OPTIONS`) — the design mock's own
`interfaceLanguageOptions` (English/Spanish/French) was never real, since
nothing in `apps/web` is actually localized (word input stays
English-only, an existing project decision). The control still renders
rather than being left out until a second language exists, matching the
mock's layout and requiring no UI change to grow later — but is
functionally inert today (there's nothing to switch to). Extending
`ALLOWED_LANGUAGES` later is an additive change under `rest.ts`'s
expand/contract rules (see "REST endpoints beyond `/health`" above), not
a breaking one.

**Scope excluded, same as Stats**: `Settings.dc.html`'s name/email/
password "profile" section (with its own separate "Save profile" button
and Save/Saved label transition) is Clerk account-management territory,
not this story — left out entirely, same scoping-down precedent as Stats
dropping its mock's "Play style" section.

## Postgres reaffirmed against graph/document alternatives for stats

**Raised by**: the user, while scoping the stats feature — Postgres was
chosen for durable history as a relational store; does that still hold once
the actual stats queries (some involving cycles/self-joins, like word
derivation chains) are known?

**Decision**: stay on Postgres. No new alternative adopted; this entry
exists so the question isn't silently re-asked later.

**Why**: the actual query shapes needed — counts/sums/averages, joins on
`game_id`/`clerk_user_id`, one per-game roster comparison for placement —
are standard relational work, not graph traversal. The one feature that
sounds graph-shaped, longest word derivation chain (CAT → CAST → CASTS →
FORECASTS), is explicitly deferred (see `docs/user-stories.md`) and was
already scoped in `docs/postgres-schema.md` to be walked in application
code over a single game's bounded `word_plays` set (at most 144 tiles),
not queried via SQL recursion or a graph database's traversal engine —
graph databases earn their keep on deep, unknown-depth traversal at real
scale (social graphs, fraud rings), which this isn't. Win streak's
sequential-fold "trickiness" is an algorithm-shape issue, solved by doing
it in JS (see "Player stats" in `docs/postgres-schema.md`) — equally
awkward as a SQL recursive CTE or a Mongo aggregation pipeline, so it isn't
an argument for either. Mongo's actual strength (schema-flexible,
denormalized, deeply nested documents) doesn't match this domain's clean,
uniform, foreign-keyed entities (`games`/`game_players`/`word_plays`);
moving to it would mean either denormalizing (fighting the "sum across a
player's games" queries this feature needs) or reinventing joins via an
aggregation pipeline, more awkwardly than SQL already does natively.

## Local dev auth: mock provider, not a Clerk sandbox

**Decision**: `apps/web` never imports `@clerk/react` (or `/legacy`)
directly — every consumer (`Header.tsx`, `LoginPage.tsx`,
`SsoCallbackPage.tsx`, `main.tsx`, `RequireAuth.tsx`, `LobbyPage.tsx`,
`NewGamePage.tsx`, `StatsPage.tsx`, `useGameSocket.ts`,
`clerkDisplayName.ts`) goes through `src/auth/index.tsx`, which switches at
build time between `clerkAuth.tsx` (a thin pass-through to real Clerk) and
`mockAuth.tsx` (a self-contained fake backed by a localStorage-persisted,
module-level session store) based on `VITE_AUTH_MODE`. Local dev sets
`VITE_AUTH_MODE=mock` in `apps/web/.env` (gitignored, per-developer);
deployed environments (Vercel) leave it unset and get real Clerk, unchanged
from before this existed. Both sides are typed against a hand-rolled
`AuthModule` interface (`src/auth/types.ts`) covering only the fields this
app actually touches, rather than Clerk's own types — needed because TS
can't emit a portable type once Clerk's inferred hook types are unioned
with a plain mock object (`TS2742`), and it also means the mock never has
to fake Clerk's full surface, only the corner used here.

`apps/server` has a matching `AUTH_MODE=mock` env var (`src/index.ts`,
`src/auth.ts`'s `verifyMockSessionToken`), never set in Railway. In that
mode the server trusts any non-empty session token as its own user id, no
signature check, no network call — the token is exactly what the mock
frontend's `useAuth().getToken()` sends (the mock user's id), so a full
create/join/play loop works end to end with zero calls to real Clerk on
either side. Without this half, the frontend mock alone wouldn't be enough
to actually play a game: every identity-bearing command is independently
re-verified server-side against a real Clerk session (see "Command
identity: derived from the Clerk session, not client-supplied"), so a fake
frontend session with no real Clerk JWT would just get every gameplay
command rejected.

**Context**: local dev started requiring an internet connection once Clerk
sign-in landed (it didn't before) — every page render now needs to reach
Clerk's real endpoints just to determine signed-in/out state, and every
gameplay command needs the server to reach Clerk to verify it. That's a
regression in dev ergonomics, not something inherent to using Clerk in
production. It also blocked automated browser-driven testing of any
signed-in flow (creating/joining/playing a game) without a human standing
in to complete a real Clerk sign-in first.

**Alternatives considered**: switching the whole app to a self-hostable
open-source auth provider (Zitadel, Logto, Hanko) so local dev could run a
real auth server on localhost with no internet. Rejected — that trades a
dev-only annoyance for a permanent ops burden (running/maintaining an auth
server in every environment) just to fix local dev, and re-opens the
"managed vs. self-hosted" tradeoff the Clerk decision above already settled
deliberately. Also considered a Clerk "sandbox"/test-mode instance — still
requires network access, so it wouldn't have fixed the actual complaint.
For the server-side half specifically, a dedicated auth-mock container in
`docker-compose.yml` (a small fake IdP other services could
point at) was also considered and rejected on the same grounds: it adds a
service to run/maintain for no functional gain over a trivial in-process
token check, since neither side of this design ever talks to a real auth
server anyway.

**Why this shape**: the mock's `create()`/`authenticateWithRedirect()` calls
always succeed immediately (no password check, no email verification step)
— it's exercising `LoginPage`'s UI and interaction flow, not simulating
Clerk's validation logic. Session state is a module-level singleton
(mirroring how Clerk's own store works) rather than React context, so every
consumer sees the same signed-in state without a provider wrapper beyond
the no-op `AuthProvider` mock — that's what let `main.tsx`,
`Header.tsx`, etc. stay structurally identical between the two modes.

**Seed user roster** (`src/auth/mockUsers.ts`): a small checked-in list of
named dev identities (Alice, Bob, Carla, Dev), each just `{ id, email,
displayName }`. `LoginPage.tsx` renders a one-click "sign in as…" list from
it (only when non-empty, i.e. only in mock mode) alongside the normal
form. This exists because this app's interesting flows are multiplayer —
two or more players in the same lobby/game — and testing that locally
needs two distinct, recognizable, _stable_ identities available across
separate browser contexts/tabs, not a fresh randomly-typed email each
time. A checked-in file rather than any runtime-generated list because
adding a dev user should be a one-line, PR-reviewable diff, no local state
to manage; it's plain fixture data, not a secret. Free-form email entry
(typed into the normal sign-up form) still works alongside it and remains
deterministic — `mockAuth.tsx`'s `userFromIdentifier` resolves a seeded
roster email to its fixed identity and derives an ad-hoc one from anything
else — so two contexts typing the same non-roster email also reliably land
on the same player, useful for edge cases the fixed roster doesn't cover
(e.g. a user with no display name).

**Test impact**: `Header.test.tsx`, `LoginPage.test.tsx`, and every page
test that renders `Header` incidentally, plus `RequireAuth.test.tsx`,
`useGameSocket.test.ts`, `StatsPage.test.tsx`, `HomePage.test.tsx`,
`RulesPage.test.tsx` — now `vi.mock("../auth", …)` (or `"./auth"`, per
relative depth) instead of mocking `@clerk/react`/`@clerk/react/legacy`
directly. They were already mocking at the module-import boundary, that
boundary just moved. `apps/server/src/auth.test.ts` covers
`verifyMockSessionToken` the same way it already covered
`verifySessionToken` — a pure mapping, no I/O, unit-tested directly.

---

## Dockerizing the frontend dev server

**Decision**: `apps/web`'s Vite dev server now runs as a `web` service in
`docker-compose.yml`, mirroring the `server` service's pattern exactly —
bind-mounts the checkout, a named volume per workspace member on its
dependency graph (`web_root_node_modules`, `web_app_node_modules`,
`web_protocol_node_modules`) so the container's own Linux-installed
`node_modules` shadow the host's, `pnpm install --filter @anagrabble/web...`
on every start rather than baked into the image, and publishes port 5173.
`vite.config.ts`'s `server.host` is now `true` (binds `0.0.0.0` rather than
the default `localhost`) — required for Docker's port publishing to reach
the process inside the container at all; harmless for a plain host run,
just additionally reachable on the LAN. `pnpm dev:web` still works as a
manual alternative (same as `dev:server` remaining after that service moved
into Docker) but is no longer the documented path — README's "Getting
started" is now a single `docker compose up -d` for the whole stack.

**Context**: raised as "we did this for the backend, why not the frontend
too" — for the backend the answer was structural (needs to be on the same
Docker network as Redis/Postgres, no real choice). The frontend has no such
dependency; it only talks to the backend over `localhost:8080`, which works
identically whether or not that's dockerized. So the only live question was
whether Docker's bind-mount filesystem layer degrades Vite's HMR badly
enough on macOS to matter — the standard folklore (osxfs-era Docker Desktop
couldn't deliver native fs events into a Linux container at all, forcing a
slow polling fallback) would make this a bad trade.

**Measured, not assumed**: rather than accept or reject that folklore
secondhand, timed how long a host-side file write took to reach the dev
server's own change-detected log line (`[vite] hmr update …`), 6 trials
each, comparing a plain host-run Vite instance against a throwaway
dockerized one on this machine (Docker Desktop 29.6, VirtioFS bind-mount
backend — the default since ~4.6, not the old osxfs/gRPC-FUSE backend the
folklore is about):

|                              | avg    | min    | max    |
| ---------------------------- | ------ | ------ | ------ |
| Native Vite (host)           | 116 ms | 100 ms | 134 ms |
| Dockerized Vite (bind mount) | 22 ms  | 14 ms  | 31 ms  |

The dockerized instance was consistently _faster_, not slower. Best
explanation: VirtioFS forwards host writes into the container's Linux
**inotify**, a cheap kernel-level primitive with no inherent batching;
native macOS file watching goes through **FSEvents**, which is a
batching/coalescing API by design and isn't built for sub-10ms delivery —
so the ~100ms native figure isn't Docker-related overhead at all, it's
roughly FSEvents' normal character. This doesn't mean Docker is
categorically faster in general — it means the specific "bind mounts can't
deliver fs events on Mac" objection is stale advice for this Docker Desktop
version, on this machine. Caveats: single run, 6 trials, one machine, and
this measures server-side detection+processing latency (log line
timestamp), not full browser-side HMR (websocket delivery + module
re-execution, which is identical in both cases since it happens after the
update is already computed) — treat as a strong signal, not a certified
benchmark. Worth re-checking if this ever regresses (e.g. a livelier-feeling
HMR loop reported as sluggish) rather than assuming Docker as the culprit
by default.

**Alternatives considered**: leaving it host-only (the status quo before
this decision) — rejected once the latency objection didn't hold up, since
the remaining upside (one `docker compose up -d` for the entire stack
instead of a Docker command plus a separate `pnpm dev:web`) was worth
taking. Also considered: a `docker-compose.override.yml` making it
optional/toggleable rather than folding it into the base file — rejected as
unneeded complexity; nothing about running it in Docker is worse than the
host path now, so there's no real reason to keep both documented as
first-class options.

---

## Mobile playability audit: icon-button touch targets, not a layout gap

**Decision**: closed out `docs/user-stories.md`'s "As a player on mobile, the
game is fully playable" story by auditing the built app (not just the design
mock) end to end at a real mobile viewport (Playwright, iPhone SE width,
375px) — full two-player flow (home → rules → sign in → create game → second
player joins → start → turn tiles → submit a word → toast) plus every other
route (`/settings`, `/stats`, `/login`) checked for horizontal overflow
(`document.documentElement.scrollWidth` vs. `clientWidth`, all clean) and
visual inspection. Found no layout or functional blocker — the mobile-specific
work already landed piecemeal (GameBoard's `useVisualViewportHeight` keyboard
fix, the mobile menu overlay, `safe-area-inset-bottom` padding, pointer- vs.
touch-aware refocus/blur on tile-turn and word-submit) had already closed the
real gaps. The one concrete, verifiable issue: several icon-only buttons
reachable mid-game on a touchscreen (`GameBoard`'s mobile menu open/close,
`InviteLinkRow`'s and `LobbyPage`'s copy-link, `RulesModal`'s close) had a
tappable area of only 16–20px (measured via `boundingBox()`), well under the
~44px touch-target minimum both WCAG 2.5.5 and Apple's HIG point at — a
generic web design pattern (`padding: 0` icon buttons) that works fine with a
mouse cursor but is genuinely harder to hit with a fingertip. Fixed with the
standard padding + matching-negative-margin technique (12px on the
more-spacious header/menu buttons, 8px on the tighter invite-link rows) —
grows the invisible hit box around each icon without moving the icon or
changing any surrounding layout (verified via before/after screenshot diff:
pixel-identical).

**Alternatives considered**: leaving these at their design-mock-inherited
size — rejected since `design-system/In Game.dc.html`'s own bare
`padding:0` icon buttons were authored mouse-first and never adjusted for
touch, so matching it exactly here would be inheriting an oversight, not a
deliberate mobile-specific call. A visible larger tap circle/background (vs.
an invisible expanded hit box) — rejected as a bigger visual departure from
the design system's restrained icon treatment than the actual problem (hit
area, not visual size) called for.

**Why not more**: didn't touch the account-avatar button (34px, already
reasonably close to the touch-target guideline and would need a visible
resize rather than an invisible one to grow further, a bigger call than this
pass was scoped for) or add a "mobile playability" regression test — the
Playwright script used for this audit was throwaway (viewport + a full
multiplayer smoke run + touch-target measurements), not integrated into
`apps/web/e2e/` as a checked-in test, since `pnpm test:e2e`'s existing scope
is deliberately minimal (see CLAUDE.md's Testing strategy) and this was a
one-time audit rather than a new interaction needing its own permanent
coverage.

---

## Realtime transport: raw `ws`, not Socket.IO

**Decision** (2026-08-12): stay on raw `ws` for the gameplay WebSocket
channel. This closes the "confirmed? not discussed" flag raised
2026-08-11 (see the now-removed "Explicitly still open" bullet below) —
raised for real discussion specifically because it became relevant while
scoping the reconnect/resync story
(`docs/user-stories.md` "Non-functional / cross-cutting").

**Alternative considered**: Socket.IO, for its built-in client
reconnect-with-backoff and room/broadcast primitives.

**Why not**, point by point against what Socket.IO actually offers:

- **Multi-instance-safe broadcast is already built**, by hand:
  `apps/server` publishes every accepted event to a Redis pub/sub channel
  (`game:events`), and every server process subscribes and re-broadcasts to
  whatever local sockets are in that game's room (`index.ts`, `rooms` Map +
  `subscriber.on("message", ...)`). This is exactly what Socket.IO's Redis
  adapter exists to provide — adopting Socket.IO would replace a working,
  small piece of code with a heavier equivalent doing the same job, not add
  a capability.
- **Resync-on-connect is already built, and transport-agnostic.** Every WS
  event carries a full `LobbySnapshot`, not a delta, and the server sends a
  fresh `LobbyState` unconditionally on every `?game=` connect — fresh
  join, page-navigation reconnect, and (once built, see "Mid-game join"
  below) a genuinely new late joiner all go through the identical path.
  Nothing about this needs Socket.IO.
- **Socket.IO's one differentiated reconnection feature doesn't cover the
  case that actually needs solving.** Connection State Recovery (v4.6+)
  replays buffered packets only to a socket ID that previously connected,
  within a short server-side window — it cannot serve a client that was
  never connected before. Mid-game join needs a general "give this viewer
  the state/history it's missing" mechanism regardless of who's asking, and
  that mechanism (the bounded-Redis-history approach below) is a strict
  superset of what CSR provides for reconnects. Once it exists, CSR's
  marginal value is ~zero.
- **Socket.IO's handshake requires load-balancer sticky sessions**, since it
  defaults to HTTP long-polling upgrading to WebSocket (multiple HTTP round
  trips before the upgrade) — a constraint raw `ws`'s single Upgrade
  request doesn't have. This cuts against this project's stated "any node
  can handle any game's command" goal (CLAUDE.md "Core architecture") for
  whenever this goes multi-instance.
- **Two overlapping version-negotiation concepts.** This app already has an
  explicit `PROTOCOL_VERSION`/`Handshake` message (CLAUDE.md "Protocol
  conventions"). Socket.IO layers its own Engine.IO protocol/version
  negotiation underneath that, for no added benefit here.
- **Testing.** CLAUDE.md's testing strategy already commits `apps/server`'s
  WS round-trip tests to "a real `ws` client against a running server."
  Socket.IO would mean swapping every test to `socket.io-client`.
- **Bundle weight.** `socket.io-client` pulls in `engine.io-client`, a
  polling transport, and its own parser, for functionality
  (reconnect-with-backoff) that's a small, self-contained piece of code to
  write directly against the native `WebSocket` API.

**Where Socket.IO would genuinely have been the right call**: an app that
needs transport fallback for hostile/proxy-heavy networks, or that hasn't
already built its own multi-instance fanout. Neither applies here.

---

## Reconnect-with-backoff: scope calls made, not blockers

**Context** (2026-08-12): shipping the client-side reconnect (`useGameSocket`'s
`RECONNECT_DELAYS_MS` backoff, commit `a7da803`) surfaced four deliberate
scope calls, recorded here so they're visible follow-ups rather than
silently dropped — same "known gap documented, not a blocker" precedent as
"Mobile playability audit" and the dictionary derivation gaps noted in
CLAUDE.md's "Still open" section.

1. **No heartbeat/ping-pong for silent connection death.** Reconnect
   triggers on the browser's `close` event, which fires promptly for a
   clean disconnect (server restart, explicit close) but can lag for a
   truly dead network path (no TCP reset received) until the browser
   eventually notices. Left out rather than built speculatively — the same
   "wait for real evidence before adding polling machinery" call CLAUDE.md
   already makes for the turn-timer sweep. Revisit if real usage shows
   players stuck on a frozen-but-not-visibly-disconnected board longer than
   the backoff schedule would explain.

   **Resolved** — see "Player presence: connected/disconnected
   tracking" below. The evidence this asked to wait for turned out to be a
   different, more concrete problem (a disconnected player holding up
   everyone else's tile-turn wait, and a bounced host losing host status)
   rather than "a frozen board," but the fix is the heartbeat this item
   anticipated: `useGameSocket` now sends `Ping` on an interval, and the
   server derives reachability from the resulting `lastSeenAt` rather than
   purely from `close` events.

2. **No command queueing/replay.** A `SubmitWord`/`TurnTile` sent while the
   socket is down or mid-backoff is silently dropped (`send()` no-ops on a
   closed socket — pre-existing behavior, unchanged by this pass). The
   reconnect fixes state staleness, not lost commands — a player who acts
   during a drop has to notice nothing happened and retry once reconnected.
   Not addressed; flag if it becomes a real complaint rather than building
   speculative queueing now.
3. **Server-side reconnect-recognition path is untested.** The
   `?game=&token=` re-seat in `index.ts`'s connection handler predates this
   pass and works, but nothing exercises it directly — doing so needs the
   first full WS-round-trip harness (Fastify + a real `ws` client, not just
   Redis via testcontainers), a bigger lift than this story's actual new
   code (the client backoff) warranted. TDD focus stayed on what was
   genuinely new; see CLAUDE.md's testing strategy, "Extends to full WS
   round-trip tests ... once there's more than the lobby/gameplay slices to
   exercise that way." (The `pendingLeaves` cancellation this originally
   also mentioned is gone — see item 4.)
4. **The 3000ms `pendingLeaves` grace period was left untouched.** The
   first backoff attempt (1s) comfortably lands inside it today, so no
   coupling change was needed — but the two constants live in different
   files (`useGameSocket.ts`, `index.ts`) with no enforced relationship. If
   either changes independently later, re-check that the first retry still
   lands inside the grace window.

   **Resolved, moot** — `pendingLeaves` itself is gone (see "Player
   presence: connected/disconnected tracking" below), removed rather
   than retuned. There's no grace-period/backoff coupling left to maintain:
   a reload or reconnect-backoff blip no longer risks any roster mutation
   at all, so the timing relationship this item worried about doesn't
   exist anymore.

None of these block the user-facing story (`docs/user-stories.md`
"connection drops and reconnects mid-game") from being marked done — a
player who drops and reconnects does see correct current state, which is
what the story promises. (1) and (4) are now resolved (see above); (3) is
the remaining one with a real future action — see "Explicitly still open"
below.

**Verified live** (2026-08-12), against the running dev stack, real
Chromium via Playwright: two browser contexts, host and guest, mid-game.
Force-closed the host's actual `WebSocket` object from page context
(`browserContext.setOffline()` was tried first and discarded — it doesn't
interrupt an already-open WS in Chromium's CDP offline emulation, so it
wasn't testing anything). While the host's socket was down, had the guest
play a real dictionary word — a genuine state change (score, claimed word,
pool letters consumed) the host never received live. Confirmed: the
"Reconnecting…" indicator appeared immediately, a new `WebSocket` instance
opened ~1s later (first backoff delay), and the host's post-reconnect UI
showed the guest's play, updated score, and emptied pool correctly — all
delivered purely through the resync snapshot, matching what the guest saw.

Turned into a permanent regression test the same day:
`apps/web/e2e/reconnect.spec.ts`. The checked-in version proves state
via a tile-turn (bank count) rather than the ad hoc dictionary-word lookup
used for the one-off manual check above — simpler and fully deterministic
regardless of which random letters a given run turns over, since turning a
tile also transfers `turnPlayerIndex` (`apply_turn_tile.lua`), so the host
turning first legitimately hands the guest a turn to make while the host is
down, with no dictionary dependency. Getting this test to pass reliably
surfaced a real lesson about testing two independent WS connections: host
and guest have no ordering guarantee on when each one's own DOM reflects a
mutation, so every read in the test waits for that specific page's own text
to change before capturing it, rather than inferring "it must have updated
by now" from what a _different_ page observed — the first few versions of
this test were flaky for exactly that reason (reading host's bank count
right after only waiting on guest's button to appear).

---

## Mid-game join: scope decisions

**Decided and built** (2026-08-12), closing the open questions flagged
when this story was split out (`docs/user-stories.md` "Core gameplay" —
"join a game that's already in progress"): cutoff, catch-up scoring,
turn-rotation handling, and join UX.

- **No cutoff.** A player can join any time `state.status === "playing"`,
  including during the post-bank-empty idle countdown, right up until the
  game actually ends (`status === "ended"`, which stays rejected).
  Considered gating on `bankCount === 0` as a natural "winding down"
  signal, but decided against restricting when someone's allowed to join.
- **No catch-up mechanism.** A late joiner starts at `score: 0`,
  `words: []` — identical shape to a lobby-phase join, no bonus points or
  extra revealed letters. The existing steal-tiebreak (prefers stealing
  from the highest-scoring player, CLAUDE.md "Word formability") already
  provides mild rubber-banding; no new mechanic for MVP.
- **Turn rotation needs no code change.** `joinGame`
  (`apps/server/src/lobby.ts`) already appends new players to the end of
  `state.players` — true today for lobby-phase joins, and nothing about
  mid-game join needs that to differ. `turnPlayerIndex` (a numeric index)
  is untouched for every existing player; a late joiner enters the
  rotation on its next natural lap, no special insertion logic needed.
- **Join UX: gate the board behind joining.** Extends the pattern
  `LobbyPage` already uses for an unjoined guest in the lobby phase
  (`isUnjoinedGuest`, "You're invited — join in") to the
  `status === "playing"` branch, rather than exposing a live read-only
  spectator view with a join banner overlaid on `GameBoard` — simpler, and
  consistent with the existing pre-start pattern rather than inventing a
  second one.

**Discovered while scoping this**: today, _before_ this story lands, a
signed-in user who opens a mid-game invite link without ever calling
`JoinGame` already sees the live `GameBoard` update in real time —
`LobbyPage` renders `GameBoard` for `status === "playing"` with no check
that the visitor is in `lobby.players`. They just can't do anything:
`apply_submit_word.lua` already correctly rejects with `PlayerNotFound` if
the submitter isn't a recognized player. This story closes that gap rather
than opening a new one — the read path was already "transport-ready" (per
"Realtime transport: raw `ws`, not Socket.IO" above, "every `?game=`
connect gets a full snapshot regardless of when it happens"); the actual
work is relaxing `joinGame`'s status check and giving that already-visible
visitor a way to become a real participant.

**Server-side change**: `joinGame`'s
`if (state.status !== "lobby") return { error: "GameAlreadyStarted" }`
narrowed to reject only `state.status === "ended"`. Originally kept the
existing `GameAlreadyStarted` code for this case too (narrowing _when_ it
fires without renaming it), but that reads backwards once the condition is
"the game has ended" rather than "the game has started" — flagged in
review. Added a new `GameAlreadyEnded` code instead (`packages/protocol/
src/ws.ts`) and use that for this rejection, leaving `GameAlreadyStarted`
untouched for its original purpose (`apps/server/src/game.ts`'s
`StartGame` rejecting a second start). A new error-code union member is
additive, same as a new field or event type — no protocol version bump
needed. Named `GameAlreadyEnded` rather than reusing the existing
`GameEnded` _event_ type's name (`GameEndedEvent`, broadcast when the
post-bank-empty idle countdown expires) — mechanically fine since one's a
`type` discriminant and the other's a `code`, but confusing to read side
by side; `GameAlreadyEnded` also mirrors the `GameAlreadyStarted` naming
convention already in use.

**Client-side change**: `LobbyPage`'s `isUnjoinedGuest` join-prompt branch
(previously only reachable pre-start) now also fires for
`status === "playing"`, ahead of the `GameBoard` render — the same Card,
player list, and Join button as the pre-start lobby view, just with
"This game's already in progress" copy instead of the share-link/config/
Start-game furniture that only makes sense pre-start.

---

## CreateGame as a REST endpoint

**Decided and built** (2026-08-12) — raised by the user while reviewing
`NewGamePage`: moved `CreateGame` off the WS command/event pair onto
`POST /games`, plain HTTP/JSON, matching the `/stats`/`/settings`
precedent (see "REST endpoints beyond `/health`" above).

**Why now, when gameplay was originally built entirely on WS**: at the
time, no REST surface existed at all — that arrived later, for `/stats`.
Worth reapplying that decision's own criterion ("no live/real-time
requirement") to `CreateGame` specifically: unlike `JoinGame`/`StartGame`/
`TurnTile`/`SubmitWord`/`EndGame`, there is no other connected client to
broadcast to, since the game doesn't exist for anyone else yet.

**What's actually wrong with the status quo**: `NewGamePage` opens a bare
WS connection (`useGameSocket()`, no `gameId`) purely to have a channel to
send one command over, disabling "Create game" until that handshake
completes (`status !== "open"`). Once the resulting snapshot arrives, it
navigates to `/:gameId`, where `LobbyPage` opens a second, fully
independent WS connection. Creating a game opens two sockets today; the
first is discarded after sending exactly one message.

**Why this slots in cleanly, not as new architecture**: `/stats`/
`/settings` already established the pattern a `POST /games` handler needs
— a thin Fastify handler that verifies the Clerk Bearer token itself
(`handleStatsRequest(db, CLERK_SECRET_KEY, authHeader, AUTH_MODE)`),
independent of the WS connection's own token-in-query-param verification.
`lobby.ts`'s `createGame(redis, cmd, hostId)` is already WS-agnostic — a
REST handler would call the exact same function, just resolving `hostId`
from the Bearer header instead of `meta.clerkUserId`. Zero business-logic
duplication.

**Mechanical bits**: CORS's methods list (`apps/server/src/index.ts`) grew
`POST` alongside `GET`/`HEAD`/`PUT`, added deliberately rather than
rediscovered the way `PUT` itself was (see the note above this file
already has about that). `CreateGameRequest` landed in
`packages/protocol/src/rest.ts`, following the existing
`PlayerStatsResponse`/`PlayerSettingsResponse` precedent (additive-only,
not versioned via `PROTOCOL_VERSION`) — the response reuses `LobbySnapshot`
(`ws.ts`) directly rather than a new type, since it's the exact shape
`toLobbySnapshot()` already produces for the WS path.

**Scope call**: `JoinGame`/`StartGame`/`TurnTile`/`SubmitWord`/`EndGame`
stay on WS — they need to notify already-connected clients, and the lobby
page's socket is open anyway regardless.

**What shipped**: `apps/server/src/games.ts`'s `handleCreateGameRequest`
— same framework-agnostic, unit-tested-in-isolation shape as
`stats.ts`/`settings.ts` (18 tests, `games.test.ts`, mocking `createGame`
and the auth verifiers rather than hitting real Redis — that coverage
already exists in `lobby.test.ts`). `apps/web/src/fetchCreateGame.ts`
wraps the `fetch()` call; `NewGamePage` no longer imports `useGameSocket`
at all. Verified live in a real browser: the create-game button is now
enabled immediately (no socket handshake to wait for), and exactly one WS
connection opens for the whole flow — on the lobby page, after
`POST /games` resolves — not the two sockets (one immediately discarded)
the WS-based flow opened before.

**Expand/contract note**: the WS `CreateGame` command (`packages/protocol`,
`apps/server/src/index.ts`'s switch) was deliberately left in place rather
than removed in this same change, per CLAUDE.md "Schema evolution" — dead
but harmless until a follow-up "contract" pass removes it once there's no
possibility of a stale frontend build still sending it.

**Contract pass done** (2026-08-17): five days and multiple Cloudflare
Pages/Railway deploys after the above, with no client ever having shipped
a WS-sending build, the `CreateGameCommand` type/union entry
(`packages/protocol/src/ws.ts`) and the WS switch case
(`apps/server/src/index.ts`) were removed. `lobby.ts`'s `createGame()` now
takes a plain `CreateGameParams` (`CreateGameRequest` plus the
server-synthesized `gameId`/`commandId`) instead of the WS command type,
since it was the last thing still tying that shared function to a WS
shape.

**`gameId` generation moved server-side** (2026-08-12 follow-up, same day)
— raised by the user reviewing the request shape right after the REST
endpoint shipped: why was the client still generating `gameId` at all,
given the WS-era reason (needing to know the id in advance to correlate a
fire-and-forget command with its later response) doesn't apply to a
REST request whose response directly returns the created snapshot?
Agreed and changed: `POST /games`'s body no longer takes `gameId` —
`apps/server/src/games.ts` generates it (`makeGameId()`, same
`Math.random().toString(36).slice(2, 7).toUpperCase()` shape the removed
client-side helper used, so invite-link codes look identical) and retries
on a `GameIdTaken` collision up to `MAX_GAME_ID_ATTEMPTS` (5 — a
sanity bound, not a tuned number; a true collision among 60M+ possible
5-char codes and a handful of concurrent games is vanishingly unlikely)
before giving up with a 500. Matches standard REST semantics (server
assigns and returns the resource's identity) and closes a trust gap:
nothing validated a client-supplied `gameId`'s shape before. Client-side
`makeGameId()` (`apps/web/src/gameId.ts`) was deleted outright as
genuinely dead code, not deprecated in place — its only caller was
`NewGamePage`. Verified live: `POST /games`'s request body now omits
`gameId` entirely, and the server-assigned code appears correctly in the
resulting invite URL.

**`commandId` moved server-side too** (2026-08-12, same-day follow-up) —
the immediate next question once `gameId` moved: does `commandId` still
need to be on `CreateGameRequest` either? Traced through
`createGame()`'s actual logic (`lobby.ts`) rather than assuming: its
dedup check (`markCommandSeen`) only ever executes inside the
`if (exists)` branch, and `exists` is checked against `gameId` — which is
now always freshly server-generated, so that branch is only ever entered
on a genuine collision with an unrelated game, never "this exact request,
resubmitted." A freshly generated `commandId` can't match anything
already recorded for that unrelated game either, so `markCommandSeen`
always correctly reports "not already applied" and falls through to
`GameIdTaken` — identical behavior to a client-supplied value, with no
changes needed to `lobby.ts` at all. So: `commandId` is genuinely optional
for this call path, not just moot-but-required as the entry above
originally concluded (correcting that). Changed: `CreateGameRequest` no
longer has a `commandId` field; `games.ts` synthesizes one
(`crypto.randomUUID()`, Node's built-in global, already this codebase's
own test-fixture convention — see `lobby.test.ts`/`game.test.ts`) once per
request, alongside the `gameId` retry loop. `commandId` stays required
and client-generated on the **WS** `CreateGameCommand` — that path's
fire-and-forget retry/reconnect case is the genuine reason the field
exists at all; REST simply never had a use for it. Verified live:
`POST /games`'s request body now omits both `gameId` and `commandId`
entirely.

---

## Planned work (2026-08-12): task breakdown and dependencies

Three pieces of work were scoped in the same conversation, agreed as
"meaty, not all in one go" — this is the dependency map, so a future
session doesn't have to reconstruct it from prose scattered across this
file. See the sections above for the reasoning behind each; this is just
the what-and-in-what-order view.

1. **`CreateGame` as a REST endpoint** — **done** (2026-08-12), see
   "CreateGame as a REST endpoint" above for what shipped. Was fully
   independent of the other two, as predicted; touched `NewGamePage`,
   `apps/server/src/index.ts`/new `games.ts`, `packages/protocol/src/rest.ts`.
2. **Mid-game join** (`docs/user-stories.md` "Core gameplay") — **done**
   (2026-08-12), see "Mid-game join: scope decisions" above for the four
   resolved questions and what shipped. Was independent of (1), as
   predicted. Touched `apps/server/src/lobby.ts`, `apps/web/src/pages/
LobbyPage.tsx`, and `packages/protocol/src/ws.ts` (additive: a new
   `GameAlreadyEnded` error code, added rather than repurposing
   `GameAlreadyStarted` — see "Mid-game join: scope decisions" above).
3. **History panel backfill** (`docs/user-stories.md` "Non-functional /
   cross-cutting") — see "Explicitly still open" below for the three
   candidate approaches, not yet decided between. **Depends on its own
   open design decision** (which of the three approaches) being resolved
   before implementation is schedulable — same "raise it when it becomes
   relevant, don't decide speculatively" pattern already used for the
   Fastify and ws-vs-Socket.IO calls above. Now the more pressing of the
   two gaps it was scoped against: a reconnecting player already has
   partial history from before the drop in the common short-gap case, but
   a genuinely new late joiner from (2) — now live — has zero history
   until this lands.

None of these three block each other at the code level — they touch
different files with no shared surface. The only real dependency is soft:
(3) is more valuable once (2) exists, and (3) itself needs a design
decision made before it's schedulable at all, the same way (2)'s four
questions needed resolving in conversation before _it_ was schedulable.

---

## Player presence: connected/disconnected tracking

**Context** (2026-08-15): a disconnected player caused two concrete
problems. Mid-game, if it was their turn, every other player waited out
the full `turnTimerSec` before anyone could force the turn forward. Pre-
start, the only presence signal was `pendingLeaves` (see "Lobby slice"
above) — a 3-second, single-process debounce whose whole reason for
existing was buying a grace window before an _irreversible_ mutation
(removing the player from `players`, which for a host meant silently
losing host status on a mere reload or backoff blip).

**Decision**: replace inferred-and-immediately-destructive presence with a
`lastSeenAt` timestamp per player, refreshed by a lightweight client
heartbeat, with "reachable" derived at read time — `!left && now -
lastSeenAt < PRESENCE_STALE_MS` — rather than tracked via any scheduled
timer. This is what makes it multi-instance-safe by construction (a value
in Redis any node can read/write) and reversible by construction (a blip
just means the value goes stale and then fresh again — nothing was ever
mutated that needs to be undone).

- **`players[]` is never mutated by connection state, at any phase.**
  Pre-start, removal only ever happens via an explicit
  `POST /games/:gameId/leave` (`handleLeaveGameRequest`, `games.ts`) — no
  grace period needed, since nothing here is inferred. Mid-game, nobody is
  ever removed, connected or not — an explicit leave just sets `left:
true`, distinguished from a disconnect only by UI copy ("left the game"
  vs. "reconnecting…", `presenceLabel.ts`), and their score/words stay on
  the board exactly like a disconnect leaves them. (This `left` flag was
  removed 2026-08-17 — see "`left` presence state removed" below — once it
  turned out `leaveGame()` was already a no-op mid-game, so nothing ever
  actually set it.)
- **Heartbeat**: `useGameSocket` sends the previously-inert `Ping` command
  (`packages/protocol/src/ws.ts`, wired but unused since it was added)
  immediately on open and every `PING_INTERVAL_MS` (8000ms) thereafter.
  The server stamps `lastSeenAt` atomically (`apply_presence.lua` —
  needed because a plain `GET`/`SET` here could clobber a concurrent
  gameplay mutation to the same state blob) and replies with a fresh
  `LobbySnapshot` on `PongEvent.lobby` (a new optional field), so every
  connected client's own heartbeat doubles as a lightweight resync of
  everyone else's presence — no separate server-initiated broadcast on
  every heartbeat tick needed.
- **Graceful close is faster than the heartbeat window**: `socket.on
("close", ...)` marks the player stale immediately (an already-expired
  `lastSeenAt`) and broadcasts a `LobbyState` resync, rather than waiting
  for the ~20s heartbeat-staleness window a silent death (cable pulled,
  phone loses signal) has no better option than.
- **Turn-timer fast-skip needed no new grace constant.**
  `apply_turn_tile.lua`'s deadline check gained an OR:
  `now >= turnDeadline OR currentPlayerUnreachable`. Since "unreachable"
  already requires either an explicit close or ~20s of heartbeat silence,
  that already satisfies "don't instantly skip on a network blip" for
  free.
- **Host derivation changed from `players[0]` to "first reachable
  player, falling back to `players[0]`."** Computed fresh on every read
  (`lobby.ts`'s `deriveHostId`/`isReachable`), so a disconnected host
  doesn't need to be removed from `players` for host status to migrate —
  and if they reconnect before anyone else has effectively claimed it (no
  claim is actually recorded; "claimed" just means someone else is now the
  first reachable player), they reclaim it automatically, no reconciliation
  needed. `game.ts`'s `StartGame` authorization now calls the same helper
  instead of keeping its own separate `players[0]` comparison, so the two
  can't diverge.
- **UI**: a small badge (`WifiOff` icon, greyed-out row) next to a
  non-connected player's name in both `LobbyPage` and `GameBoard`'s player
  lists, driven by a derived `presence: "connected" | "disconnected"`
  field computed fresh into every `LobbySnapshot` (`toLobbySnapshot`)
  rather than sending the raw timestamp to clients (clock-skew sensitive).
  (Superseded for `GameBoard` specifically — see "`left` presence state
  removed" below.)

**Removed**: `pendingLeaves`, `scheduleLeave`, `cancelPendingLeave`,
`LEAVE_GRACE_MS` (`apps/server/src/index.ts`) — see "Lobby slice" above for
the "Superseded" note. This also resolves item 1 and item 4 of
"Reconnect-with-backoff: scope calls made, not blockers" above, and the two
`Explicitly still open` bullets about heartbeat detection and the
`pendingLeaves` host-status-loss edge case (both removed from that list —
this section is where they landed).

**Alternatives considered**: an explicit `hostId` field instead of
position/reachability-derived host status. Rejected — it would need its
own reconciliation logic for exactly the case presence-derivation gets for
free (a reconnecting original host reclaiming status without an explicit
handoff step), and CLAUDE.md's `players[0]` convention already had no
persisted `hostId` for a deliberate reason (see "redis-schema.md 'Host
convention'"); extending that same "derive, don't store" philosophy to
reachability was more consistent than introducing storage now.

**Caught by checking before assuming** (2026-08-15, same day): the
server-side fast-skip (`apply_turn_tile.lua`'s `currentPlayerUnreachable`
OR condition) shipped first, on the assumption that CLAUDE.md's existing
"any connected client fires TurnTile once its local countdown hits zero"
client behavior would exercise it automatically. It didn't — `GameBoard`'s
background auto-fire effect only ever checked `Date.now() >= turnDeadline`
(the _original_ deadline), so the new early-accept branch had no client
code path that could ever reach it; the fast-skip was fully inert in
practice. Found by reading the actual effect before writing a Playwright
test that would have either passed for the wrong reason (waiting out the
full 60s timer) or failed outright, rather than assuming the server-side
change was sufficient. Fixed the same day: the effect now also fires
early once `currentPlayer.presence !== "connected"`, reusing the existing
per-deadline dedup guard.

**Verified live** (2026-08-15), against the running dev stack, real
Chromium via Playwright (`apps/web/e2e/presence.spec.ts`, same
force-close-the-real-`WebSocket` technique as `reconnect.spec.ts` — see
"Reconnect-with-backoff" above): two browser contexts, host and guest.
Force-closed the host's socket immediately after `StartGame` (host has the
first turn, `turnPlayerIndex` starts at 0), with a 60s `turnTimerSec` so
the ordinary deadline can't be what advances things. Confirmed the guest's
bank count changes within ~2s — well before the 60s timer, and entirely
without the host ever reconnecting — proving the full round trip: real WS
close → server's close handler → `applyPresence` → published `LobbyState`
→ guest's `useGameSocket` adopts the new snapshot → `GameBoard` recomputes
`currentPlayerUnreachable` → its effect fires `TurnTile` early → the Lua
script's fast-skip branch accepts it. Also confirmed the test is a real
regression guard, not a false positive: temporarily reverted the
client-side fix above and re-ran the same test — it failed (20s timeout,
bank count never moved), then passed again (~2s) once the fix was
restored.

---

## `left` presence state removed

**Context** (2026-08-17): the original presence design (above) gave an
explicit mid-game leave its own sticky `left: true` flag, distinct from a
transient disconnect — different UI copy ("Left the game" vs.
"Reconnecting…") and a different icon (`UserMinus` vs. `WifiOff`) in
`GameBoard`'s player list. Revisiting it turned up two problems:

1. **It was never actually wired to a mutation.** `leaveGame()`
   (`apps/server/src/lobby.ts`) is a no-op once `state.status !== "lobby"`
   — a deliberate, already-documented choice (`docs/redis-schema.md` "Host
   convention") — so `POST /games/:gameId/leave` mid-game never sets
   `left` on anything. The only places `left: true` ever appeared were
   hand-written test fixtures exercising the read-side derivation
   (`isReachable`/`presenceOf`/the Lua reachability check); no code path
   in production could ever produce it.
2. **The distinction wasn't even conceptually sound.** "Left" reads as
   permanent, but a mid-game leave isn't — a player who clicks "Leave
   game" can reconnect into the same game exactly like anyone whose
   connection just dropped, since `players[]` never removes them either
   way. There was no separate rejoin flow that needed the distinction to
   hang off of.

**Decision**: collapse `left`/`"left"` presence entirely into the existing
disconnected/reachable model. A mid-game "Leave game" click now behaves
identically, end to end, to any other dropped connection: the socket
closes, `isReachable` goes false immediately (no grace window), and the
player shows the same "away" treatment as anyone else who's unreachable.

- **Protocol**: `PlayerState.left` removed; `presence` narrowed from
  `"connected" | "disconnected" | "left"` to `"connected" |
"disconnected"` (`packages/protocol/src/ws.ts`). This is a breaking wire
  change, not additive — accepted without an expand/contract rollout
  because `left` was already dead in production (see point 1 above); there
  was no live traffic actually depending on the removed value.
- **Server**: `isReachable`/`presenceOf` (`apps/server/src/lobby.ts`) and
  `apply_turn_tile.lua`'s mirrored reachability check drop the `left`
  branch — both now purely a function of `lastSeenAt`.
- **UI**: went further than just deleting the "left" branch — removed the
  `GameBoard` player-list badge entirely (icon + visible text), not just
  its "left" variant. The hollowed color-swatch ring plus the row's
  existing `opacity: 0.55` (`playerRowMuted`) already read as "this player
  is away" without narrating it in a badge; the icon/text was judged
  unnecessary rather than merely redundant with "left". A `title`
  attribute on the row keeps a hover tooltip for anyone who wants the
  explicit word, without it competing visually with the player list. That
  tooltip says "Disconnected", not "Reconnecting…" (`presenceLabel.ts`'s
  prior copy, carried over from the original design above) — "Reconnecting…"
  implies an active, likely-to-succeed-soon process that isn't actually
  knowable; the player could just as easily be gone for good. `LobbyPage`'s
  pre-start player list already only ever showed a bare icon with an
  `aria-label` (never visible text, and never reachable via a "left"
  presence pre-start in the first place), so it needed no change beyond
  the type simplification and the same copy fix.
- **Removed test coverage**: `apps/server/src/lobby.test.ts`'s
  `presence "left"` case, `packages/redis/src/applyTurnTile.test.ts`'s
  "current player who explicitly left" case, and the `GameBoard`/
  `LobbyPage` badge tests asserting "Left the game" copy — all exercised a
  state no production code path could reach.

**Why now, not deferred further**: raised as a simplification question
("do we need to differentiate left vs. disconnected in the player list at
all?"), and confirming the mid-game leave endpoint's no-op behavior while
answering it turned "nice-to-simplify" into "delete confirmed-dead code."

---

## Presence: reconnect handshake stamps and broadcasts presence directly

**Status: implemented 2026-08-15**, same day as "Player presence:
connected/disconnected tracking" above and the "Turn ownership"
migration below — found while manually verifying reconnect behavior after
that work landed.

**The bug** (found live, not by inspection): after a disconnected player
reconnected, other players kept seeing their presence badge for ~8-16s
after the reconnect actually completed, and — more seriously — a
reconnected-but-not-yet-refreshed current player could still be fast-
skipped out of their own turn by another player during that window.

**Root cause**: the reconnect handshake (the `gameId`-triggered branch of
`wss.on("connection", ...)` in `apps/server/src/index.ts`) never called
`applyPresence` at all — it only `send`s a read-only resync snapshot to
the reconnecting socket itself. The only thing that ever wrote a fresh
`lastSeenAt` was the `Ping` heartbeat handler, gated on `meta.playerId`
being set. `useGameSocket.ts` does fire a `Ping` immediately on socket
`open` specifically to avoid waiting a full `PING_INTERVAL_MS`, but that
optimization was structurally defeated: `meta.playerId` is set by a
_separate_ continuation off the same `identityReady` promise, one with an
extra Redis round-trip (`loadLobbySnapshot`) after `identityReady`
resolves, while the `Ping` handler only awaits `identityReady` itself
before checking `meta.playerId`. The reconnect chain is therefore
structurally slower than the immediate ping by at least that one Redis
call, so the "fire immediately" ping consistently arrived to find
`meta.playerId` still unset, fell through to a bare no-op `Pong`, and
presence didn't actually refresh until the client's _next scheduled_
heartbeat — up to `PING_INTERVAL_MS` (8s) later. Compounding it: unlike
`markDisconnected` on close (which explicitly `publish`es a room-wide
`LobbyState`), the reconnect path never broadcasts either, so other
clients only learn about it via their own next heartbeat's `Pong`
snapshot — up to another `PING_INTERVAL_MS` on top. Since
`apply_turn_tile.lua`'s reachability check just reads whatever
`lastSeenAt` is sitting in Redis at call time with no notion of actual
socket state, a reconnected player could be for-real fast-skipped by
another player racing them during that window — not just a UI lag, a
real turn-loss bug.

**Fix**: the reconnect handshake now stamps presence itself, synchronously
as part of re-seating the player, instead of relying on this socket's own
heartbeat to eventually get there. Once it confirms the verified identity
is actually an existing player in this game, it calls `applyPresence`
directly (same atomic Lua-backed write already used by `markDisconnected`
and the `Ping` handler) and then `publish`es a room-wide `LobbyState` with
the result — mirroring `markDisconnected`'s existing broadcast-on-the-way-
out with a symmetric broadcast-on-the-way-back-in. The reconnecting
socket doesn't also get a direct `send` in that case: it already
`joinRoom`-ed itself moments earlier, so the `publish` fans back out to it
too via the existing Redis pub/sub loopback — same pattern `JoinGame`
already uses for a genuinely-new player (publish only, no direct send, to
avoid double-delivering the event). The direct-`send`-of-the-plain-
snapshot path is kept only as the fallback for a fresh anonymous viewer
(not a returning player) and for the defensive case where `applyPresence`
itself errors.

No protocol, Lua, or client change needed — this reuses `applyPresence`
and `publish` exactly as they already existed. Server-only, single file,
single PR.

**Testing**: this is a real-WS-boundary timing bug (a promise-ordering
race inside `wss.on("connection")`), squarely Playwright's lane per
CLAUDE.md's testing strategy, not Vitest's — and building the WS
round-trip harness that could unit-test `index.ts`'s connection handler
directly was explicitly deferred (see "Explicitly still open" below) as
its own separate, nontrivial refactor (the whole file is a top-level
script, not a callable factory today), not bundled into this fix.
Extended `apps/web/e2e/presence.spec.ts`'s existing disconnect/fast-skip
test with a reconnect-recovery half: after confirming the host's own
local status clears (proving the socket actually reconnected), assert the
guest's presence badge for the host clears within a **tight 3s bound** —
the actual regression check, since "eventually" would have passed under
the old ~8-16s behavior too.

**Caught by checking before assuming, again**: the fix initially appeared
to only partially work (passed at an 8s bound, failed at 3s) — investigated
with temporary timestamped logging before concluding the fix was flawed,
which instead surfaced an unrelated environment issue: the `server`
container's `tsx watch` process had stopped picking up edits to
`index.ts` itself (still reacting fine to edits in files it imports, like
`lobby.ts`) partway through the session, so every test run had actually
been exercising the old, unfixed code. A container restart (prompted to
the user per CLAUDE.md's "don't restart running services yourself"
convention) resolved it; the 3s bound then passed reliably across
repeated runs.

---

## Turn ownership: `turnPlayerIndex` → identity-based, not array position

**Status: implemented 2026-08-15**, in a fresh session per the hand-off
below. The expand/contract question the sketch flagged was raised with the
user rather than assumed: **single-shot rename**, not a two-rollout
expand/contract — justified by there being no real deployed users yet to
break compatibility for. `GameState.turnPlayerIndex: number` became
`turnPlayerId: string | null` directly, in one PR, across
`packages/protocol`, both Lua scripts, `apps/server`, and `apps/web`.

The rest of this section is the original hand-off write-up — context got
large enough mid-conversation that the user asked for this to be captured
in the repo rather than carried forward in chat history, so a fresh session
could implement it correctly without having witnessed the discussion.
Written 2026-08-15, immediately after "Player presence:
connected/disconnected tracking" above, which is what surfaced this.

**The bug** (found live, not by inspection): with a player disconnected
mid-game, the _other_ player's next tile-turn click visibly turns over two
tiles at once.

**Root cause**: `apply_turn_tile.lua` advances turn ownership with
`state.turnPlayerIndex = (state.turnPlayerIndex + 1) % #state.players` —
a position in the _raw_ `players[]` array. That array still includes a
disconnected player (mid-game nobody is ever removed — see "Player
presence" above, deliberately, so their score/words stay on the board).
The presence fast-skip lets _any_ client fire `TurnTile` early once the
current player is unreachable, and that call draws a real tile exactly
like a genuine turn — there's no "skip without playing" concept, just
"anyone may take this turn once eligible." So with 2 players and one
gone, every other "turn" is a phantom one: player 1 clicks, draws a tile,
hands the turn to the absent player 2; within ~250ms player 1's own
background auto-fire effect (`GameBoard.tsx`, the same one added to reach
the fast-skip branch at all — see "Caught by checking before assuming"
above) silently skips player 2's turn too, drawing a second tile, before
handing the turn straight back to player 1. One click, two tiles. With
more players it's less dramatic (once every N turns instead of every
other one) but the same underlying issue.

**Two fix directions discussed**:

- **Option A (contained, Lua-only)**: keep `turnPlayerIndex` as a raw
  array index, but in `apply_turn_tile.lua`, _before_ the existing
  eligibility check, walk it forward past any run of consecutive
  unreachable players — no tile drawn during the walk, `turnDeadline`
  reset at each hop — until it lands on a reachable player. Only then does
  the existing check-and-draw logic run. No protocol or client changes.
- **Option B (identity-based)**: stop representing "whose turn" as a
  position in `players[]` at all. Replace `turnPlayerIndex: number` with
  an identity-based field, advanced by player id rather than array
  position. Bigger: a wire protocol change, a Lua rewrite, and every
  client read site.

**Decision: Option B.** Reasoning (the user's, worth preserving exactly):
CLAUDE.md already has an unrelated-but-adjacent "Still open" item — an
eventual _backend_ turn-timer polling sweep, replacing today's mechanism
where the fast-skip only ever fires because some other client's browser
tab happens to be open running the background auto-fire effect. That
backend sweep is **explicitly not being built as part of this piece of
work** — the trigger stays exactly as it is today (client-triggered),
unchanged. But whenever the sweep does get built, it will need to
consume/produce whatever "whose turn is it" representation exists at that
time. Doing the identity-based migration now avoids doing it twice: a
contained Lua fix today, then a bigger refactor later when the sweep
lands and position-based indexing turns out not to be enough for it
anyway. So B is a "pay once" call, not a "let's be fancy" call — and the
user confirmed scope explicitly: **just the data-model change**, not the
backend-sweep move.

**Implementation sketch, for whoever picks this up**:

- `packages/protocol/src/ws.ts`: `GameState.turnPlayerIndex: number` is
  replaced by an identity-based field — `turnPlayerId: string | null`
  is the natural shape (`null` only for the pathological case where
  literally every player is unreachable; decide/document what that means
  for eligibility — most likely "nobody can currently take a turn," not a
  crash). This is a genuine field rename/repurpose, not additive, so it
  doesn't fit CLAUDE.md's normal within-one-PR expand/contract shape
  cleanly. Two honest options for the fresh session to raise with the
  user rather than assume: (a) do the full two-rollout expand/contract
  (backend populates both fields for one deploy, then a later PR drops
  `turnPlayerIndex`), or (b) a single-shot rename, justified by there
  being no real deployed users yet to break compatibility for. Don't pick
  silently — this is exactly the kind of call CLAUDE.md's "Schema
  evolution" section cares about.
- `apply_turn_tile.lua`: turn advance becomes "walk to the next player
  _by id_, skipping consecutive unreachable ids, no draw during the
  walk" — same skip-without-draw mechanic Option A described, just keyed
  by id instead of array index.
- `apps/server/src/game.ts` (`startGame`) / `lobby.ts`: initial turn
  assignment sets `turnPlayerId` to the host's id instead of
  `turnPlayerIndex: 0`.
- `apps/web/src/pages/GameBoard.tsx`: `currentPlayer =
lobby.players[lobby.turnPlayerIndex]` becomes
  `lobby.players.find(p => p.id === lobby.turnPlayerId)`.
- Tests to update/extend: `packages/redis/src/applyTurnTile.test.ts` (the
  walk-past-unreachable-without-drawing behavior is the key _new_ case;
  existing assertions on `turnPlayerIndex` become `turnPlayerId`),
  `apps/server/src/game.test.ts`, `apps/web/src/pages/GameBoard.test.tsx`.
- Live verification: this deserves the same treatment as "Player
  presence" above got (see its "Verified live" note) — extend
  `apps/web/e2e/presence.spec.ts` or add a case confirming a single click
  never draws more than one tile even with an absent player in a
  2-player game, before considering this done. The existing test in that
  file already force-closes a socket right after `StartGame` with a 60s
  timer; the natural extension is asserting the bank count only ever
  changes by one tile per observed step, not verifying "it changed" alone
  (which is exactly what let the original bug ship unnoticed by the first
  version of that test).

**Out of scope, explicitly**: the backend turn-timer polling sweep itself
— see CLAUDE.md "Still open." Not touched by this migration; still
client-triggered after this lands.

**What actually landed**, matching the sketch above field-for-field:
`turnPlayerId: string | null` on `GameState`; `apply_turn_tile.lua`'s
advance now walks forward from the current player's array position,
skipping any run of unreachable players without drawing for them, landing
`turnPlayerId` on the next reachable one (or `cjson.null`, not Lua `nil` —
assigning a table field to Lua `nil` deletes the key rather than encoding
JSON `null`, which would have silently dropped the field from the wire
payload in the all-unreachable case); `apply_submit_word.lua`'s turn
transfer just sets `turnPlayerId` to the submitter's own id directly (no
walk needed — the submitter is reachable by construction, since they just
made an atomic move); `lobby.ts`/`game.ts` seed `turnPlayerId` from the
verified acting host id, not array position 0; `GameBoard.tsx` looks up
the current player with `players.find(p => p.id === turnPlayerId)`. Two
new `applyTurnTile.test.ts` cases cover the walk directly (a 2-player case
mirroring the exact production bug, and a 3-consecutive-unreachable case)
— both were confirmed to actually fail against a naive
always-advance-one-slot implementation before the real fix was restored,
per CLAUDE.md's TDD convention. `presence.spec.ts`'s existing case was
extended to assert the bank count drops by exactly one tile on the
force-advance and then holds steady for a few seconds after, rather than
just "it changed" — run live against the real docker-compose stack, not
just Vitest.

---

## Redis client: node-redis, not ioredis

**Decision** (2026-08-19): migrated `packages/redis` and `apps/server` from
`ioredis` to `redis` (node-redis), the client Redis Inc. now officially
maintains and recommends. `ioredis` was the original scaffold-time pick
(`9c40f29`, 2026-08-08) with no recorded rationale — it predates this file's
"new sections follow Decision/Alternatives/Why" convention, and no comparison
against node-redis was ever written down. Raised for a real evaluation
2026-08-19 after checking upstream status: Redis Inc. has since deprecated
`ioredis` in favor of node-redis (it's still shipping releases, maintenance
is "best-effort" on the legacy track, not the steered-toward default for new
work or migrations — see their own migration guide at
`redis.io/docs/latest/develop/clients/nodejs/migration`).

**Why migrate now rather than later**: the two things that usually make a
Redis client migration expensive — cluster/Sentinel topology and a large
custom-command surface (`defineCommand`, see "Hand-written Lua vs. a
query-builder" above, which this project tried and reverted) — don't apply
here. Usage was four `EVAL`-based Lua wrappers (`packages/redis`), plain
`multi()`/`duplicate()`/pub-sub (`apps/server`), and no cluster. Small,
mechanical surface, and it only gets larger as more gameplay slices land —
cheaper to move while the codebase is still young than to accumulate more
call sites on the deprecated track first.

**What changed**, mechanically:

- `packages/redis/src/client.ts`: `new Redis(url, opts)` → `createClient({
url, ...opts})`. Unlike ioredis, node-redis doesn't connect on construction
  — every caller now explicitly `await`s `.connect()` (`apps/server/src/index.ts`
  for the main client and the pub/sub `subscriber` duplicate; the four
  `packages/redis` test files' `beforeAll`).
- The four Lua wrappers (`applyTurnTile`/`applySubmitWord`/`applyEndGame`/
  `applyPresence`): `redis.eval(script, numkeys, ...keysAndArgs)` (positional)
  → `redis.eval(script, { keys: [...], arguments: [...] })` (node-redis's
  object form).
- Pub/sub (`apps/server/src/index.ts`): node-redis passes the message
  listener directly to `subscribe(channel, listener)` instead of a separate
  `.subscribe()` call plus a global `.on("message", (channel, msg) => ...)`
  handler.
- Multi-word commands took node-redis's camelCase names: `sadd` → `sAdd`,
  `rpush` → `rPush`, `llen` → `lLen`, `flushall` → `flushAll`. Single-word
  commands (`get`/`set`/`incr`/`expire`/`exists`/`multi`/`publish`/`ping`/
  `duplicate`) were unchanged.
- Test teardown: ioredis's `.disconnect()` → node-redis's `.destroy()` (the
  non-graceful immediate-close equivalent; node-redis's `.disconnect()` is
  deprecated in favor of it).
- Dropped the `maxRetriesPerRequest: 3` default `client.ts` set on every
  client — an ioredis-specific per-command retry cap with no direct
  node-redis equivalent, unused by any override elsewhere in the codebase,
  and not worth reinventing against node-redis's own (different but
  reasonable) offline-queue/reconnect defaults.

Verified against real Redis (not just typecheck): all 42 `packages/redis`
tests and all 83 `apps/server` tests pass unchanged (behavioral coverage, not
rewritten for the migration), and the docker-compose `server` container
was restarted and confirmed booting clean (`[redis] connected to
redis://redis:6379`, `/health` returns `{"redis":"ok"}`, no subscriber
errors).

---

## Pre-push git hooks over documentation-only convention

**Decision**: a `pre-push` git hook, managed by `simple-git-hooks`
(configured via the root `package.json`'s `simple-git-hooks` key, installed
automatically by the root `postinstall` script), runs `pnpm lint && pnpm
format:check && pnpm typecheck && pnpm test` — the same four checks
CI gates on — before any push leaves the machine.

**Context**: this repo originally leaned on documentation over enforcement
tooling for local checks (see "Run `pnpm format:check` before every commit"
in CLAUDE.md's prior wording, and the explicit call at the time: "I don't
think a pre-commit hook is necessary... maybe this is just something that
should be in the Claude MD"). That approach didn't hold: CI broke more than
once from checks (formatting, lint, occasionally a failing test) that were
documented as required but not actually run before push, because nothing
local enforced it.

**Alternatives considered**:

- **Pre-commit hook running everything** — rejected: `pnpm test` includes
  testcontainers-backed integration tests (`apps/server`, `packages/redis`)
  that spin up real Redis via Docker; running that on every commit would
  make small, frequent commits painful.
- **Pre-commit hook running fast checks only (lint-staged), full suite on
  pre-push** — a reasonable split, but rejected in favor of the simpler
  option below: no pre-commit hook at all, so commits stay completely
  unconstrained, and the full gate only runs once, at the point code
  actually leaves the machine.
- **Husky + lint-staged** — the more common choice for this kind of setup,
  but heavier than needed here since nothing runs pre-commit and there's no
  staged-file filtering to do; `simple-git-hooks` is a minimal wrapper that
  just wires an npm script to a git hook, which is all this needed.
- **lefthook** — a solid dependency-free alternative (single Go binary,
  parallel execution), not picked mainly because the checks here already
  run sequentially via one pnpm command and don't need lefthook's
  parallelism.

**Why pre-push, not pre-commit**: pre-push runs once per push rather than
once per commit, so it doesn't slow down the actual editing/committing
loop, while still catching everything before it can reach CI — the actual
failure mode this was meant to close. Skippable via
`SKIP_SIMPLE_GIT_HOOKS=1 git push` for genuine emergencies (a bypass
`simple-git-hooks` provides itself), not meant as a routine escape hatch.

---

## Explicitly still open

- **A real WS round-trip test harness** (Fastify + a real `ws` client
  against a running server, per CLAUDE.md's testing strategy) to cover the
  server-side reconnect-recognition path (`?game=&token=` re-seat in
  `index.ts`) — see "Reconnect-with-backoff: scope calls made, not
  blockers" above (item 3). Untested today; the client-side backoff logic
  that prompted this write-up has its own coverage (`useGameSocket.test.ts`),
  but this server-side path predates it and was never exercised directly.
- **`API_URL` becoming canonical, `WS_URL` derived from it.** See "REST
  endpoints beyond `/health`" above for the full reasoning (written when
  both were still `VITE_API_URL`/`VITE_WS_URL` — see "Runtime-injected
  frontend config, not build-time VITE_* vars" for the rename). Do this
  once `API_URL` is confirmed set in every deployed environment: (1)
  refactor `useGameSocket.ts` to derive its WS URL from `API_URL` (scheme
  swap: `http:`→`ws:`, `https:`→`wss:`); (2) remove the standalone `WS_URL`
  entry from `env.js`.
- **Hand-written Lua vs. a query-builder/wrapper for `packages/redis`.**
  Flagged 2026-08-11 as worth an actual pros/cons conversation before
  treating "hand-written Lua" as settled precedent for anything else (e.g.
  it was cited, questionably, as prior art for the original plain-`pg`-no-
  ORM pick above). **Discussed 2026-08-17, kept as-is**: there isn't really
  a "Redis query builder" category the way SQL has Kysely/Knex — the
  complexity in these scripts is business logic (turn-ownership walking,
  reachability, dedup), not command composition, so a builder/DSL wouldn't
  earn its keep, especially given CLAUDE.md's "Word resolution
  implementation split" already keeps Lua scripts small/auditable by
  policy. Two smaller, concrete alternatives were prototyped and both
  backed out rather than adopted:
  - **`defineCommand`-registered custom commands** (`redis.applyTurnTile`
    etc.) instead of each wrapper calling `redis.eval(SCRIPT, numberOfKeys,
...)` by hand — built and fully working (ioredis manages
    `EVALSHA`-with-fallback, `numberOfKeys` declared once), but reverted:
    the actual wins (one fewer literal to duplicate, wire bandwidth that
    doesn't matter at this script size) didn't clearly justify the added
    surface area (a new file's worth of `declare module "ioredis"`
    boilerplate per command) at only 4 scripts total. Same "revisit once
    real usage justifies it" bar this file applies to Redis HA and the
    turn-timer sweep — not ruled out for later, just not worth it yet.
  - **Consolidating the `words:{}`/`pool:{}` → `[]` empty-array patch**
    (lua-cjson can't distinguish an empty table from an empty object) into
    one shared TS helper — considered, found not viable rather than just
    not worth it: the patch happens _before_ each script's own
    `redis.call('SET', ...)`, so it fixes the **persisted** value, not just
    the return value. Moving it to a TS-side post-processing step would
    silently reintroduce the bug in storage while only masking it for
    whoever reads it back through that one wrapper — caught by the existing
    test that asserts the raw stored bytes, not just the returned value.
    Redis's sandboxed Lua also has no `require`/shared globals across
    separate `EVAL` scripts, so there's no way to factor it into shared
    _Lua_ code either. That duplication (4 near-identical `string.gsub`
    pairs, one per script) is inherent to the architecture, not a refactor
    target.
- **Turn-timer polling sweep** — see "Game rules" above.
- **Evaluating Cloudflare Pages for frontend hosting**, raised 2026-08-14
  after repeated friction getting a permanent Dev environment working on
  Vercel: Vercel ties a stable custom domain to either the Production
  environment or a paid-tier non-prod environment, which is why
  `dev.anagrabble.com` is aliased to a Vercel Production deploy today (see
  "🔥 Deploy the Dev frontend to Vercel production, not preview"). Cloudflare
  Pages gives every branch alias a stable subdomain on the free tier, which
  would let Dev and Production be genuinely separate environments instead
  of overloading Vercel's Production env for both. **Resolved 2026-08-15**:
  adopted — DNS/custom domains cut over and the Vercel deploy jobs dropped
  entirely, see "Frontend hosting cutover: Vercel to Cloudflare Pages"
  above for the full decision. Still open: whether to keep baking `VITE_*`
  values in at build time or move to a runtime-injected, environment-agnostic
  bundle — deferred until after this cutover specifically so it would only
  need implementing against one platform; see CLAUDE.md "Still open / not
  yet decided" for the current state of that follow-up.
- **Redis HA timing** — see "Redis hosting" above.
- **Linking games/stats to a Clerk user ID durably** — nothing writes
  history to Postgres yet at all (gameplay is Redis-only, per "Backend
  state architecture" above), so this is blocked on that landing first,
  not on identity — identity is already Clerk-based.
- **History panel backfill on reconnect/late join** — split out
  (2026-08-12) as its own follow-up, separate from both the "connection
  drops and reconnects mid-game" story (`docs/user-stories.md`
  "Non-functional / cross-cutting" — state resync, now shipped, see
  "Sequencing" in CLAUDE.md) and the mid-game-join story
  (same file, "Core gameplay") — neither of those covers whether a
  reconnecting or late-joining client can see the history panel's _past_
  plays, only current state. Today it can't: the history panel is purely
  client-accumulated from events seen live (see "History panel is
  client-side only" above) — a client that wasn't connected the whole time
  just has a gap. Its own user story in `docs/user-stories.md`
  "Non-functional / cross-cutting". Candidate approaches, not yet decided
  between, not yet needed until that story is picked up:
  - **Bounded recent-history in Redis state** — add a capped list (e.g.
    last 50 events) to `GameState` itself, appended to on each accepted
    move, so a full resync payload includes it for free (no extra round
    trip, no Postgres involvement). Simple, cheap, but a very long game's
    full history wouldn't be fully recoverable this way — only the most
    recent N plays.
  - **Uncapped growth in Redis state** — same idea, no cap, so full-game
    history is always recoverable via resync. Avoids the truncation
    tradeoff above, but an ever-growing per-game blob has its own cost
    (state size, network payload per resync) that scales with game length.
  - **Read from Postgres** (the durable-history path in CLAUDE.md's "Core
    architecture", not yet built — see "Linking games/stats to a Clerk user
    ID durably" just above) — full fidelity for any game, but only works
    once that table exists and is populated in real time (its writes are
    explicitly async/off-critical-path today, which is a different
    latency/staleness shape than "give me the live history right now"), and
    it's a genuinely different access pattern (occasional query) from the rest of the live
    gameplay path.
  - These aren't mutually exclusive — e.g. bounded-Redis for the common
    case (short gap, recent reconnect) with Postgres as a fallback for a
    late joiner wanting the full game so far. Worth resolving deliberately
    when the reconnect story is actually picked up, not defaulted into.
- **Display names (`hostName`/`playerName`) are client-supplied, not
  derived from the verified Clerk session.** Raised 2026-08-12 while
  reviewing the new `POST /games` endpoint, but applies identically to
  `JoinGame`'s `playerName` too — not something specific to that one
  endpoint. Clerk session tokens (what `verifySessionToken`/
  `resolveActingPlayerId` verify) reliably carry only `sub` (the user id),
  not profile fields like first name, unless a Clerk JWT template is
  explicitly configured to embed custom claims — not set up in this app.
  Without that, the server would need a live call to Clerk's Backend API
  (`GET /v1/users/{userId}`) per request to look up the display name
  itself: real latency and a new external dependency on the critical path,
  for data the frontend's Clerk SDK already has loaded for free
  (`getDisplayName(user)`, no extra round trip there). Explicitly left
  undecided (2026-08-12) — the current client-supplied behavior stays as
  is for now, but this isn't a decision to leave it that way permanently,
  just a deliberate non-decision. The trust gap is real, if low-stakes:
  nothing server-side cross-checks a claimed name against the real Clerk
  profile, but names are cosmetic only — every authorization/scoring/
  ownership check uses the verified `hostId`/`playerId`, never the name.
  Candidate fix, not yet built: configure a Clerk JWT template to embed
  the display name as a verified custom claim, so the server reads it
  straight off the already-verified token with no extra round trip — the
  right fix if this ever matters enough to justify the Clerk dashboard
  configuration work. A live Backend API lookup per request was also
  considered and is strictly worse than the JWT-template approach for the
  same outcome — not worth building either way.

---

## User stories move from `docs/user-stories.md` to GitHub issues

**Decision** (2026-08-23): product-scope user stories are now tracked as
GitHub issues, the same tracker already used for architecture/cleanup
follow-ups since 2026-08-18 (see "Track user stories and open
follow-ups/todos as GitHub issues" in CLAUDE.md's "Working conventions").
`docs/user-stories.md` is archived, frozen, at `docs/archive/user-stories.md`
— a historical record of what shipped before the cutover, not a living
backlog. No new stories are appended there; new ones are filed as issues
directly, with no separate mirroring step.

**Context**: the 2026-08-18 follow-ups-as-issues convention deliberately
carved out an exception for `docs/user-stories.md`, reasoning that it was
the canonical _product-scope_ backlog and the smaller architecture/cleanup
todos were the actual problem being solved. In practice the same drift risk
that motivated that change applies here too — a md-file list doesn't get
status/labels/close-on-resolve for free, and this file had already grown to
several hundred lines mixing done/in-progress/not-started stories with
substantial inline implementation notes.

**Why archive rather than delete**: the existing entries are a genuinely
useful implementation-history record (many are cross-referenced from this
file's own decision entries above, e.g. "Mid-game join: scope decisions",
"Mobile playability audit"), so deleting it would break those references
for no benefit. Freezing it in `docs/archive/` keeps that history readable
without implying it's still maintained or that it's where a new story
should be added.

---

## Lobby -> Game wire rename

**Decision** (2026-08-25, anagrabble#38): renamed the wire type
`LobbySnapshot` to `GameSnapshot`, the `lobby` field it's carried under on
every WS event to `game`, and the full-resync event `LobbyStateEvent`/
`"LobbyState"` to `GameSnapshotEvent`/`"GameSnapshot"`. Alongside it,
`apps/web/src/pages/LobbyPage/` became `pages/GamePage/` and
`apps/server/src/lobby.ts` became `gameSession.ts` (with its
`toLobbySnapshot`/`loadLobbySnapshot`/`LobbyError` exports renamed to
match). `GameStatus`'s `"lobby"` enum value — the narrower "pre-start
phase" meaning — is deliberately untouched; only the "whole game session at
any status" sense of "lobby" moved.

**Context**: flagged in anagrabble#38. `LobbySnapshot`/`lobby` trace back to
"Lobby slice: routing and Redis schema" above — the very first slice built
was create/join/leave, before gameplay existed, so "the lobby" and "the
whole game session" were the same thing by definition at the time. That
same decision deliberately made `GameState` "the _full_ eventual game
state... not a lobby-only shape," specifically so gameplay could fill in
placeholders later "without a reshape" — and that's exactly what happened:
`StartGame`/`TurnTile`/`SubmitWord`/`EndGame` all ended up reusing the same
`lobby: LobbySnapshot` field on their events, unrenamed, for every gameplay
slice built since. The result was `GameStatus`'s own `"lobby"` value (the
narrow, correct, pre-start-only sense) sitting one field away from
`LobbySnapshot` (the broad, "whole session, any status" sense) — internally
consistent but confusing to anyone who only knows the colloquial "lobby
means waiting room" meaning, which is exactly what made `LobbyPage`
rendering the entire game lifecycle (not just the pre-start screen) read as
a misnomer.

**Scope decision**: the alternative was a page/server-only rename (leave
`LobbySnapshot`/the wire `lobby` field alone, just rename the page and
`lobby.ts`) — safer, since it touches no wire shape and needs no rollout
coordination. Went with the full rename anyway: a page-only rename would
have fixed the confusing part users/readers actually see while leaving the
same "lobby" ambiguity baked into the protocol layer underneath, which is
exactly the kind of half-fix CLAUDE.md's "docs that drift silently... are
worse than no docs" reasoning argues against applying to code structure
too.

**Rollout — two commits, not one diff**: a rename of a wire field/type is a
genuine breaking change under CLAUDE.md's expand/contract discipline
(`packages/protocol`), and this repo pushes straight to `main` with every
push deploying (no PR gate, see "Working conventions" - no PR workflow) —
so "two rollouts" here means two real, separately-deployed commits, not two
hunks in one PR.

- **Expand commit**: added `game`/`GameSnapshot` as new fields/types
  alongside the still-present `lobby`/`LobbySnapshot` (both populated with
  the same value by `toGameSnapshot()`), and added `GameSnapshotEvent`/
  `"GameSnapshot"` as an additional, not-yet-emitted member of the `Event`
  union — purely additive, safe to deploy alone. The frontend switched to
  reading `event.game ?? event.lobby` (tolerating an old backend that
  hasn't redeployed yet) and added a `case "GameSnapshot":` arm identical to
  `case "LobbyState":` (so it already understands the future wire value).
  All the page/file/prop renames (`LobbyPage` -> `GamePage`, `lobby.ts` ->
  `gameSession.ts`, `lobby` props -> `game` throughout the component tree)
  rode along in this same commit since none of them are wire-visible.
- **Contract commit**: once the expand commit is confirmed live, drop the
  old `lobby` field and `LobbySnapshot`/`LobbyStateEvent`/`"LobbyState"`
  entirely, flip the backend to emit only `"GameSnapshot"`/`game`, remove
  the frontend's now-dead `?? event.lobby` fallback and `"LobbyState"` case,
  and bump `PROTOCOL_VERSION` (matching the precedent set when `hostId`/
  `playerId` were removed from the wire protocol) so a genuinely stale tab
  logs the mismatch instead of silently getting `undefined` where it
  expects a snapshot.

## WS connect query param rename: game -> gameId

**Decision** (2026-08-25, anagrabble#42): renamed the WS connection URL's
query param from `game` to `gameId` (`apps/web/src/client/gameSocketClient.ts`,
read back in `apps/server/src/wsConnection.ts`). Flagged while reviewing
anagrabble#38's WS _event payload_ field rename (`lobby` -> `game`) — this is
a different wire surface, the connect-time _query param_, sent once per
connect rather than per event, but had the same underlying misnomer: the
value is a gameId, not a game object, and both sides even named the local
variable `gameId` right after reading it.

Deliberately deferred until #38's contract commit landed (909a157), so only
one wire rollout was in flight at a time.

**Rollout — two commits**, same expand/contract discipline as #38 (see
"Lobby -> Game wire rename" above for why this repo needs two real deploys,
not one diff):

- **Expand commit**: the client now sends the gameId under both
  `?gameId=` (new) and `?game=` (old) on every connect; the server reads
  `url.searchParams.get("gameId") ?? url.searchParams.get("game")`, so
  either an old client talking to a new server, or a new client talking to
  an old server, still resolves the game. Purely additive, safe to deploy
  in either order.
- **Contract commit**: once confirmed live, the client drops the `game`
  param and the server drops the `?? url.searchParams.get("game")`
  fallback, sending/reading `gameId` alone.

Unlike #38, there's no `PROTOCOL_VERSION` bump here: that field versions the
JSON message protocol negotiated over the `Handshake` message, not the
connect-time query string used to establish the socket in the first place.
A genuinely stale tab (never reloaded since before the contract commit,
still sending only `?game=`) does fail to resolve its game once the
contract commit lands — same risk any expand/contract window carries — but
there's no message-shape mismatch for a version check to detect; it's
covered by giving the expand phase real time to reach open tabs before
contracting, not by protocol versioning.

## Rate limiting: app layer, not infra

**Decision** (2026-08-28, anagrabble#45): closed the "no throttling or
payload caps anywhere" gap entirely in application code, not infra config —
a 16KB `maxPayload` on the `ws` server (`apps/server/src/server.ts`); a
per-connection, in-memory token bucket (`apps/server/src/rateLimiter.ts`)
gating `SubmitWord`/`TurnTile` at ~5/sec burst, 60/min sustained
(`wsConnection.ts`, new `RateLimited` `ErrorEvent` code); and
`@fastify/rate-limit` on the REST surface (`restRoutes.ts`) — 100/min per IP
globally, tightened to 5/min on `POST /games` specifically, keyed by IP
rather than Clerk user id since the rate-limit hook runs before that
route's own `authenticate()` call.

**Why app layer**: considered Railway config, a dedicated nginx/Envoy
layer, and Cloudflare. Railway has no rate-limiting/WAF surface at all — no
lever to configure. A standalone proxy layer would be a new deployable
component this repo doesn't otherwise run, against its minimal-infra bias
(single Redis container, stateless Node — see "Why not Akka/Pekko" and the
Deployment section of CLAUDE.md). Cloudflare-proxying `api.anagrabble.com`
is a genuinely good complementary move (cheap DNS toggle, free edge-level
DDoS/bot/rate-limit protection, and the team already trusts Cloudflare for
the frontend) but can't substitute for this work: it can throttle REST
requests per IP, but can't inspect individual JSON messages inside an
already-open WebSocket, so per-command gameplay throttling has to live in
`apps/server` regardless. Split out as its own follow-up, anagrabble#51,
since it's a production DNS change deserving its own deliberate rollout
rather than riding along inside this code-focused issue.

**Why per-connection/in-memory for the WS token bucket, not Redis-backed**:
a WS connection is pinned to a single Node instance for its whole life, so
there's nothing to coordinate across instances — unlike the Lua-script
atomicity the rest of the state machine relies on, this is abuse
protection, not correctness. The REST limiter's in-memory store does have a
real caveat: if the Railway service is ever scaled to multiple replicas, it
under-counts per client (each replica keeps its own counter). `@fastify/rate-limit`
supports a Redis-backed store as a drop-in swap, and Redis is already in
this stack, so that's cheap to add later — same "revisit once real usage
justifies it" posture as Redis HA (anagrabble#3), not built preemptively.

**A `@fastify/rate-limit` gotcha worth flagging**: `errorResponseBuilder`'s
return value is `throw`n internally, and Fastify reads `.statusCode` off
the thrown value to set the actual HTTP status — a plain `{ error: string }`
object with no `statusCode` field silently comes back as a 500, not 429,
even though the response body looks correct. Fixed by including
`statusCode: context.statusCode` in the builder's return value (so the body
now carries a `statusCode` field alongside `error`, a small deviation from
this file's usual bare `{ error: string }` shape, forced by the library).

**Frontend**: no changes. `SubmitWord`'s `RateLimited` error already
surfaces through `narration.ts`'s `errorText()`, which has a
`default: return fallback` branch for any unrecognized code; `POST /games`'s
429 already surfaces through `NewGamePage.tsx`'s existing catch-all, which
already collapsed every `CreateGameError` code (including `Unauthorized`)
into one generic message before this. `TurnTile`'s limiter is effectively
unreachable by a real user (turn-gated by a 15–60s timer, auto-fired at
most once per turn), so it gets no UI treatment — same reasoning already
used to suppress `NotYourTurn` in that file.

## Error tracking: Sentry behind a `reportError` wrapper

**Decision** (2026-08-29, anagrabble#46): wired Sentry into both apps behind
a thin in-house wrapper — `apps/server/src/observability.ts` and
`apps/web/src/observability/` — so no other module imports `@sentry/*`,
mirroring the way `apps/web/src/auth/` is the only place that knows Clerk
exists. Errors only: `tracesSampleRate: 0`, no session replay, no
profiling. Added the two things that genuinely didn't exist before the SDK
could be useful: `process.on("uncaughtException"/"unhandledRejection")`
handlers plus a Fastify `onError` hook on the backend, and a React
`ErrorBoundary` on the frontend (an uncaught render error previously just
blanked the page).

**Two projects, not four**: `anagrabble-server` and `anagrabble-web`, with
Dev and Production separated by Sentry's own `environment` tag
(`SENTRY_ENVIRONMENT` on Railway; `SENTRY_ENVIRONMENT` in `env.js` on
Cloudflare Pages) rather than a project per environment. Considered
mirroring the Railway/Cloudflare four-way split exactly, and rejected it:
alert rules would have to be duplicated per project, and the same bug seen
in Dev and then in Production would appear as two unrelated issues instead
of one with two environments on it. Environment is a first-class filter in
Sentry's UI and alert conditions, so nothing is lost by tagging rather than
splitting.

**The actual work is classification, not installation.** Most "error" paths
in this codebase are not bugs: `NoDecomposition`, `DerivationBlocked`,
`NotAWord`, `NotYourTurn`, `GameNotFound`, `RateLimited`, `Unauthorized`
and friends are the state machine correctly refusing an ordinary play, and
reporting them would put dozens of events per game into the tool and bury
the real ones. The rule, encoded once at each call site and worth keeping
to for anything added later:

- **Report** an unexpected throw (`wsConnection.ts`'s command catch-all is
  where a Lua `EVAL` failure, a malformed script reply, or an unreachable
  Redis actually surfaces), an infra fault (Redis connection, Postgres
  migration or durable-history write, Clerk verification _throwing_), or a
  state that shouldn't be reachable.
- **Don't report** anything that ends in `sendError` with a domain code, an
  expired session failing to verify (as opposed to verification throwing),
  unparseable JSON on the socket, or `/health`'s 503 (Railway's healthcheck
  already surfaces that one).
- **`reportWarning`** for the in-between: `SubmitWord` losing the
  `apply_submit_word.lua` re-verification race (`StaleState`), exhausting
  `MAX_GAME_ID_ATTEMPTS`, and a WS protocol-version mismatch. None is a
  thrown error; all three should be rare, and knowing how rare is the input
  for deciding whether to build the retry loop CLAUDE.md's "Word resolution
  implementation split" describes but `game.ts` doesn't yet do.

**Why a `dedupeKey` throttle**: the turn-timer sweep ticks once a second on
every Node instance, and node-redis re-emits connection errors for as long
as an outage lasts — either could turn a single fault into tens of
thousands of events against a 5k/month free tier. `ReportThrottle`
(`observability.ts`) collapses repeats of a key to one per minute. It gates
only the _send_: every occurrence is still `console.error`'d, so Railway's
log stream is exactly as complete as it was before this existed.

**Why an `onError` hook rather than `setErrorHandler`** on Fastify: the hook
observes without owning the response, so `@fastify/rate-limit`'s custom 429
body and every route's existing `{ error: string }` shape are untouched.
Only 5xx is reported — a 4xx is the API correctly saying no.

**Source maps by debug ID, not by release**: `@sentry/vite-plugin` runs only
when `SENTRY_AUTH_TOKEN` is present (CI's `build` job), and
`build.sourcemap` is tied to the same condition so a build that can't
upload-and-delete its maps never emits them for Cloudflare Pages to serve.
Uploading from `build` rather than either deploy job is what keeps the
single artifact promotable: `ci.yml` builds once, Dev deploys it, and
`deploy-production.yml` later promotes that same artifact unchanged
(CLAUDE.md "Deployment"). Debug IDs are what make that work — the bundle
carries an id per chunk that matches the uploaded map, so one
unparameterized build symbolicates correctly in both environments, which a
release-name-matched upload could not do without parameterizing the build
per environment and breaking build-once/deploy-twice. The `release` the app
reports at runtime comes from `env.js` (the commit SHA, resolved in
production from the promoted CI run's `head_sha` rather than
`github.sha` — the workflow is `workflow_dispatch`ed, so `github.sha` is
whatever `main` points at when someone clicks the button, not what the
artifact was built from) and is used for grouping/regression tracking only.

**Configuration follows the existing runtime-injection rule**, not a
`VITE_SENTRY_DSN`: the DSN, environment, and release are written into
`dist/env.js` by CI and read through `src/env.ts` like `API_URL` and
`CLERK_PUBLISHABLE_KEY` — see "Runtime-injected frontend config, not
build-time `VITE_*` vars". A new `optionalEnv()` sits alongside
`requireEnv()`, since an unset DSN is a normal configuration (local dev,
tests) rather than a broken deploy. `vite.config.ts` does read
`process.env.SENTRY_AUTH_TOKEN`, but that's build-tooling config that never
reaches the bundle, so it doesn't reopen that decision.

**No PII**: `sendDefaultPii: false` on both sides. The only identifier sent
is the opaque Clerk user id, attached as a tag (server) or via
`Sentry.setUser({ id })` (frontend) — enough to distinguish one player
hitting a bug ten times from ten players hitting it once, with no name or
email. The frontend additionally redacts `?token=` out of any URL in an
event or breadcrumb, since the WS URL carries a live Clerk session token.
Considered `sendDefaultPii: true` (would allow contacting an affected
player directly) and fully anonymous (no identifier at all); the middle
option was chosen deliberately. This is a real privacy-surface change, so
`PrivacyPage.tsx` was updated in the same pass — Sentry is now named as a
second data processor alongside Clerk, with what's sent and the 90-day
retention spelled out.

**Why not OpenTelemetry**: error tracking (capture, grouping, alerting) is
a subset of observability; OTel is the vendor-neutral standard for the rest
(traces, metrics, logs) and converges with tools like Sentry rather than
competing. Full tracing earns its keep once there's cross-service request
flow to follow, and this backend is deliberately one stateless service type
(see "Why not Akka/Pekko"), so it would instrument a single hop. Revisit
if the architecture ever splits into multiple backend services.

**Alternatives considered**: GlitchTip self-hosted (Sentry-SDK-compatible,
no new sub-processor, but it means running and backing up another
Postgres + Redis + worker stack — real ops cost against this repo's
minimal-infra bias, and the backup story is already an open question,
anagrabble#47); and structured logging only (pino + Railway log search,
which is free but offers no grouping, no dedup, no alerting on a _new_
issue, and nothing at all for the frontend).

**Not done here, by design**: Sentry projects, DSN/token repo variables and
secrets, Railway env vars, and alert rules are dashboard work, not code —
without them the code is inert but harmless (no DSN, no reports, no source
map upload, everything still logs to console). Fixing `StaleState` to
actually retry is also out of scope; this only instruments it.
