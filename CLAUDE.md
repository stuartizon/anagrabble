# Anagrabble — CLAUDE.md

This file orients Claude (chat or Claude Code) working on this repo. It captures
architecture decisions and the reasoning behind them, so we don't relitigate settled
questions or silently drift from agreed constraints. See `docs/decisions.md` for a
fuller log; this file is the condensed, load-bearing summary.

## What this is

Anagrabble: a real-time multiplayer word game. Letter tiles are turned over one at a
time (on a rotating per-player turn timer); any player, at any time, can claim a word
formable from the revealed tiles and/or steal existing claimed words by extending or
combining them. Correctness hinges on deterministic "first wins" resolution when two
players race to submit overlapping words.

## Repo structure (monorepo)

```
docker-compose.yml  Local dev stack: Redis, Postgres, the backend server
                     (bind-mounted, hot-reloading), a one-shot mock-stats
                     seed, and Adminer — see README.md "Getting started"
apps/server/     Node.js + TypeScript — stateless WebSocket/HTTP gateway
apps/web/        Frontend — React + Vite, fed by the Claude Design export in design-system/
packages/game/   Domain logic: word resolution, steal rules, dictionary validation
packages/protocol/ Shared TS types: commands, events, WS message shapes
packages/redis/  Lua scripts + typed Redis client wrapper
infrastructure/  dev.Dockerfile — the toolchain image docker-compose.yml builds
design-system/   Claude Design export (tokens, components, screen prototypes)
docs/            decisions.md, redis-schema.md, archive/user-stories.md
                 (frozen — see "Working conventions" below)
```

Node/TS chosen over reviving the old Akka codebase — see "Why not Akka/Pekko" below.

## Core architecture: Redis as authoritative live state

- **Redis holds current game state** (pool, players, scores, turn index, deadline,
  seq number). All mutations happen via atomic Lua (`EVAL`) scripts — this is what
  guarantees deterministic ordering when two players race on the same word. See
  `docs/redis-schema.md` for the exact key convention and state shape (already
  in place from the lobby slice; gameplay fills in the fields it left at
  defaults, not a reshape).
- **Postgres holds durable history** (events, results) — written _after_ Redis
  accepts a move, never on the critical path of resolving a race. Use Neon (or
  Supabase) for free-tier scale-to-zero Postgres, separate from Railway. See
  `docs/postgres-schema.md` for the table shapes and exactly what this does
  and doesn't cover — notably, stats/audit history only, not a mechanism for
  reconstructing an in-progress game if Redis is lost (see that file's
  "Scope" section and `docs/decisions.md` "Postgres scope: stats/audit
  history, not Redis recovery").
- **Node servers are stateless.** Any node can handle any game's command — Redis is
  the single serialization point, not node/actor placement. This is what makes
  horizontal scaling and node death low-stakes: a dead node loses nothing, because
  no node ever held authoritative state.
- Every accepted mutation increments `seq`. Clients use `seq` to detect dropped
  WebSocket messages and trigger a full state resync rather than silently drifting.

## Why not Akka/Pekko (context, not open for relitigating)

An earlier Akka-based prototype exists (single-node, in-memory `GameManager` actor
per game, no persistence, no clustering, no command idempotency). Verdict: salvage
the _domain logic_ conceptually (single-writer-per-game mental model, immutable
state), rewrite the infra layer. Reviving it into something with real failover would
require Cluster Sharding + Persistence + idempotency + resilient WebSocket fanout —
essentially a full rewrite with more constraints, not less work than starting fresh
in Node + Redis.

The general tradeoff, for future reference: Pekko gives cheap in-memory scheduled
operations (e.g. turn timers) at the cost of needing real persistence/recovery
machinery to survive a node crash. Redis gives a slightly less elegant single-node
story but crash-survival falls out almost for free, since no single process is ever
load-bearing for any piece of state.

## Deployment

- **Backend (Node) + Redis**: Railway. Start with a single Redis container (no HA
  template) — acceptable risk at current scale (few concurrent games). Revisit the
  Sentinel/cluster HA templates only once real usage justifies the added complexity.
- **Postgres**: Neon (free tier, scale-to-zero) rather than Railway's
  always-metered Postgres — durable history is written infrequently, so this is
  effectively free for a long time.
- **Frontend**: Cloudflare Pages — static/CDN hosting, free tier, kept separate
  from Railway since there's no reason to serve static assets from a metered
  compute container. Was Vercel until 2026-08-15; switched because Vercel ties a
  stable custom domain to either the Production environment or a paid-tier
  non-prod environment, whereas Cloudflare Pages gives every branch alias a
  stable subdomain on the free tier, letting Dev and Production be genuinely
  separate environments (`dev.anagrabble.com` on the `dev` branch alias,
  production on the `production` branch alias) instead of overloading one
  environment for both. See docs/decisions.md "Evaluating Cloudflare Pages for
  frontend hosting" for the full history, including the shadow-deploy period
  this cutover replaced.
- **Frontend config is runtime-injected, not baked into the JS bundle at
  build time.** `apps/web` builds once, unparameterized; CI then writes
  `dist/env.js` (`window.__ENV__ = {...}`) from that job's environment
  right before deploy, loaded via a `<script>` tag in `index.html` ahead of
  the app bundle — `src/env.ts` is the only place that reads it. See
  docs/decisions.md "Runtime-injected frontend config, not build-time
  `VITE_*` vars".
- Everything is Dockerized and cloud-agnostic in principle; Railway is a deployment
  choice, not an architectural dependency. AWS remains the fallback if/when real HA
  or infra control requirements emerge (see docs/decisions.md for the full
  Railway-vs-AWS-vs-Fly-vs-self-hosted comparison).
- **Both platforms deploy only after CI passes.** `.github/workflows/ci.yml`'s
  `deploy-backend`/`deploy-frontend` jobs (`needs: [lint, format, typecheck,
build, test]`, `main`-push only — those five run as separate parallel jobs,
  not one combined job)
  call the Railway CLI / `wrangler pages deploy` directly rather than relying on
  either platform's push-triggered auto-deploy, targeting Dev (Railway's
  `development` environment; Cloudflare Pages' `dev` branch alias, with
  `dev.anagrabble.com` connected to that alias via Cloudflare's custom-domain
  UI rather than CI-side aliasing). Production
  deploys are a separate workflow file,
  `.github/workflows/deploy-production.yml` (`deploy-backend-production`/
  `deploy-frontend-production`), triggered only by `workflow_dispatch` — kept
  out of `ci.yml` so the purely-manual promotion path isn't mashed in with
  the push/PR-triggered jobs. Neither job runs the
  lint/format/typecheck/build/test gate — promotion only ever targets
  `main`, which already passed it on the push that landed it — see
  docs/decisions.md "Deploy gating: Railway/Vercel wait for CI, via a
  custom deploy job" for the full
  reasoning, the required repo secrets (`RAILWAY_TOKEN_DEVELOPMENT` and
  `RAILWAY_TOKEN_PRODUCTION` are deliberately separate, environment-scoped
  tokens, not one shared token), and the manual dashboard step (disabling
  each platform's
  own auto-deploy) this doesn't do for you. This closes the "red build
  reaches prod" gap but not backend/frontend deploy ordering relative to each
  other — expand/contract protocol discipline (below) still covers that.
- **Error tracking is Sentry, behind a `reportError` wrapper** —
  `apps/server/src/observability.ts` and `apps/web/src/observability/` are
  the only modules that import `@sentry/*` (same containment rule as
  `apps/web/src/auth/` for Clerk). Errors only, no tracing/replay. Two
  projects (`anagrabble-server`/`anagrabble-web`), with Dev and Production
  separated by Sentry's `environment` tag rather than a project each. The
  DSN reaches the frontend through `env.js` like every other runtime value,
  never a `VITE_*` var, and with no DSN configured (local dev, tests) the
  whole thing degrades to plain console logging with no network calls.
  Frontend source maps are uploaded from CI's `build` job and resolved by
  debug ID, which is what lets one unparameterized bundle symbolicate in
  both environments. See docs/decisions.md "Error tracking: Sentry behind a
  `reportError` wrapper".

## Game rules — the parts that affect protocol design

- **Tile turning is turn-based**: only the current player (by identity, not
  array position — `turnPlayerId: string | null` on `GameState`, see
  docs/decisions.md "Turn ownership: turnPlayerIndex -> identity-based, not
  array position") may turn a tile, gated by a per-turn countdown
  (`turnTimerSec`, configurable 15–60s). This is a _different_ concurrency
  problem than word submission — effectively single-writer by construction,
  but the deadline must still be server-verified, never trusted to the
  client.
- **Word submission/stealing is free-for-all**: any player, any time. This is the
  actual "first wins" race the whole Redis/atomicity design exists for.
- **Playing/stealing a word also transfers the tile-turn**: the submitter
  becomes the current player, same as if they'd turned a tile — see
  docs/decisions.md "Word play transfers the tile-turn" for why this needed
  confirming rather than assuming (the two design references disagreed).
  `apply_submit_word.lua` reassigns `turnPlayerId`/`turnDeadline` as part
  of the same atomic mutation.
- **Scoring**: 1 point at `minWordLength`, +1 per letter beyond it — see
  docs/decisions.md "Scoring" for the formula, why (not raw word length),
  and a flagged-but-unsolved tension with future cross-game stats.
- **Turn timer enforcement**: the current player can fire `TurnTile` early;
  the server's own turn-timer sweep (`apps/server/src/turnTimerSweep.ts`)
  force-advances it even with nobody connected — polling a Redis sorted set
  (`games:turnDeadlines`, scored by `min(turnDeadline, currentPlayer's
presence deadline)` — see "Disconnected-player fast-skip" below) every
  second on every Node instance, independently, with no coordination
  between instances. Either path ends at the same `apply_turn_tile.lua` Lua
  script, which is what actually verifies `now >= turnDeadline` (or
  unreachability) server-side — see docs/decisions.md "Turn-timer polling
  sweep" for the implementation and why running uncoordinated on every
  instance is safe (the sweep never claims a specific player identity, so
  it can't reproduce the double-tile-draw race a real client once could).
- **Disconnected-player fast-skip**: the deadline check above also passes
  once the current player is unreachable (stale heartbeat, including
  immediately after their socket closes — whether from a dropped
  connection or clicking "Leave game" mid-game), so an away current player
  doesn't make everyone wait out the full `turnTimerSec` — the turn-timer
  sweep participates in this too, not just a connected client: it tracks
  each game's current-player presence deadline alongside its nominal
  `turnDeadline` (docs/decisions.md "Turn-timer polling sweep" →
  "Presence-aware scoring"), so an away current player gets swept
  regardless of who else is or isn't connected. See "Player
  presence: connected/disconnected tracking" below for the full presence
  model this and host migration both derive from — a `lastSeenAt`
  timestamp per player, refreshed by a client heartbeat, with reachability
  computed at read time rather than tracked via any scheduled timer.
- **Player presence: connected/disconnected tracking.** `players[]` is
  never mutated by connection state, at any phase — pre-start, removal
  only happens via an explicit `POST /games/:gameId/leave`; mid-game, that
  same endpoint is a no-op (nobody is ever removed once the game has
  started), and clicking "Leave game" is otherwise indistinguishable from
  any other dropped connection: both just let the socket close, which
  marks the player stale immediately rather than waiting on the heartbeat
  window, and both get the same "away" treatment (hollowed color swatch,
  muted row, "Disconnected" tooltip — not "Reconnecting…", which would
  imply an active, likely-to-succeed-soon process nobody can actually
  know) until/unless they reconnect. There's
  deliberately no separate `left` flag or distinct copy for an explicit
  leave vs. a disconnect — that distinction was removed as unnecessary
  complexity that also didn't hold up on inspection: it was never actually
  wired to any mutation (a mid-game `POST /leave` always no-opped), and a
  mid-game leave isn't even permanent — a player can reconnect into the
  same game, same as any other disconnect. See docs/decisions.md "Player
  presence: connected/disconnected tracking" for the full history,
  including the removal. Presence lives as `lastSeenAt` on each
  `PlayerState`, refreshed by `useGameSocket` sending the `Ping` command on
  an interval; the server stamps it atomically (`apply_presence.lua`, to
  avoid clobbering a concurrent gameplay mutation to the same state blob)
  and replies with a fresh snapshot on `Pong`, so every connected client's
  own heartbeat doubles as a lightweight resync of everyone else's
  presence. Host (`redis-schema.md` "Host convention") is derived as the
  first _reachable_ player, not raw `players[0]`, so a disconnected host
  doesn't block anything and doesn't need removing for status to migrate.
  Replaced the old `pendingLeaves` in-memory debounce entirely.
- **Word formability — the client never specifies HOW a word forms.** The server
  infers the decomposition:
  - Pool letters alone → always valid if letters present.
  - Exactly one existing claimed word + ≥1 pool letter → the classic steal
    (CAT + S = CAST). A single word reused with _zero_ additions is invalid.
  - Two or more existing claimed words combined (pool letters optional) → valid.
  - **Priority when multiple decompositions exist**: (1) any decomposition that
    steals from another player, (2) pool-only, (3) extending your own word(s) only.
  - **Tiebreak when multiple valid decompositions exist within the same priority
    tier** (e.g. word stealable from either of two different opponents): prefer
    stealing from the **highest-scoring player** (mild rubber-banding, decided).
  - **Derivation is not a legal steal.** The dictionary (see "Dictionary"
    below) records, per word, the root it's a derivation of (e.g. ABATED's
    root is ABATE). Stealing a claimed word into its recorded root's derivative
    (ABATE claimed → ABATED) is not a legal play, even though it's letter-formable
    — `packages/game/src/dictionary.ts`'s `isDerivedFrom`. This applies
    however the extra letters would be sourced (pool letters or combined with
    another claimed word); the point is blocking a trivial extension, not the
    letter source. Not positional — the rule isn't specifically about
    suffixes, it's whatever the dictionary records as a root relationship
    (currently suffix-only in practice, a known data gap, not a code
    constraint — see docs/decisions.md "Dictionary source and format").
    Reported as its own distinct error, `DerivationBlocked`, separate from
    `NoDecomposition` — see docs/decisions.md "DerivationBlocked as its own
    rejection reason" for why this one earns distinct copy when
    letters-unavailable and bare-resubmission don't.
  - **Letters are checked before the dictionary.** `resolveWordPlay`
    (`packages/game/src/resolution.ts`) rejects on letter-unavailability
    (`NoDecomposition`) before it ever checks whether the word is real
    (`NotAWord`). A word that isn't even formable right now must never reveal
    whether it's a real word — otherwise SubmitWord becomes a free dictionary
    lookup for words a player is only scouting for later, not attempting to
    play (see docs/decisions.md "Letters checked before dictionary"). Once
    the letters genuinely are available, `NotAWord` is legitimate
    present-tense feedback about a play that could actually be attempted.
  - **Duplicate word claims are allowed.** A word already claimed by someone
    (even by the same player) can be independently claimed again by anyone,
    as long as the letters are genuinely available — a claimed word is not a
    globally-unique, permanently-reserved string. Each independent claim
    scores fully on its own, no discount for a repeat (see docs/decisions.md
    "Duplicate word claims are allowed"). There is deliberately no "already
    claimed" rejection code.
- **Word resolution implementation split** (do not put full combinatorial search
  in Lua):
  1. Node reads current state from Redis (plain read, no lock), runs the full
     decomposition search in TypeScript (`packages/game`), applies priority +
     tiebreak, produces a concrete resolved plan: `{ usedWords, usedPoolLetters }`.
  2. Node submits that resolved plan to a Lua script, which does a cheap atomic
     _re-verification_ (referenced words still owned/present, pool still has those
     exact letters) and applies the mutation, or returns "stale, retry" if state
     moved between steps 1 and 2.
  3. This keeps the hard-to-test combinatorial logic in TypeScript, keeps the Lua
     script small/auditable, and preserves atomicity for the actual mutation.

### Dictionary

- Loaded in-memory in the Node process from a flat file — see
  `packages/game/src/dictionary.ts` (`isWord`, `rootOf`, `isDerivedFrom`).
- `packages/game/data/dictionary-source.csv` is the raw source (comma-delimited
  word,root); `packages/game/data/dictionary.csv` is the derived file the code
  actually loads, produced by `pnpm build:dictionary`
  (`packages/game/scripts/build-dictionary.mjs`), which flattens multi-hop root
  chains to each word's ultimate root so the runtime check is a single lookup.
  Regenerate after editing the source. See `docs/decisions.md` "Dictionary
  source and format" for the full reasoning and known gaps in the source data.

## Protocol conventions

- **Command idempotency**: every client command carries a `commandId` (UUID). The
  Lua layer dedups against a short-lived per-game set so retries/reconnects never
  double-apply a move.
- **Sequencing**: every accepted event carries a monotonic `seq` for gap detection
  and resync.
- **Schema evolution — expand/contract, enforced on every PR touching
  `packages/protocol`**:
  - Changes must be additive-only within a single PR (new optional fields, new
    event types — never rename/remove/repurpose an existing field).
  - Genuine breaking changes require two separate rollouts: an "expand" PR
    (backend tolerates both old and new shapes) deployed first, then a later
    "contract" PR removing old-shape handling once you're confident all clients
    have upgraded.
  - Include a `protocolVersion` field in the WS handshake so the backend can detect
    a stale client and prompt a refresh rather than silently misbehaving.
  - Rationale: backend and frontend deploy independently (Railway + Cloudflare
    Pages, separate auto-deploy pipelines, no cross-platform ordering guarantee) — a
    single commit touching both apps will not deploy atomically, so both versions
    must tolerate briefly talking to each other.

## Testing strategy

Framework per layer, and why. Some of this has landed (lobby-slice coverage);
some is still the plan a layer's tests follow once the feature they depend on
exists — marked below.

- **`packages/game`** (domain/decomposition logic, no I/O): **Vitest** for unit
  tests (a smoke test on `DEFAULT_GAME_CONFIG` today). **fast-check** for
  property-based tests lands once the word-resolution search exists (generate
  random pools + claimed-word states, assert invariants like "every
  decomposition's letters are a subset of what's available" rather than
  hand-writing every case) — highest bug-risk, easiest-to-test code in the
  repo, prioritize it via TDD (see "Test-driven development" below) when that
  story is picked up.
- **`packages/redis`** (Lua re-verification/mutation scripts): **Vitest**
  against a **real Redis** (`@testcontainers/redis`, same harness as
  `apps/server`'s integration tests below) — not a mock, since the point is
  verifying atomic behavior under real `EVAL` semantics. Landed for
  `apply_turn_tile.lua` (the tile-turning story's Lua script — the lobby
  slice still mutates Redis directly via `MULTI`, not `EVAL`; see
  `apps/server/src/gameSession.ts`/`game.ts` for which paths use which), including
  the concurrent-race case: fire two eligible `TurnTile` calls at the same
  script back-to-back right after a deadline passes, assert exactly one
  wins deterministically. The word-submission story will add its own
  script(s) here the same way, covering its own concurrent-race case (two
  overlapping word claims).
- **`apps/server`** (WS/HTTP gateway): **Vitest** integration tests against
  a **real Redis** via `@testcontainers/redis` — idempotency dedup, `seq`
  bumps, and state-machine guards, not mocked, for the same reason as above.
  Covers `gameSession.ts` (create/join/leave-game) and `game.ts` (start-game/
  turn-tile command validation and error codes — the Lua script's own
  atomicity/race coverage lives in `packages/redis` above, this layer just
  covers the wrapper). Extends to full WS round-trip tests (a real `ws`
  client against a running server) once there's more than the lobby/gameplay
  slices to exercise that way.
- **`packages/protocol`** (schema evolution guarantees): **deferred** — a
  compatibility test (a checked-in fixture of the previous protocol version's
  message shapes must still parse under the current types, and vice versa)
  needs at least two real protocol versions to diff; `PROTOCOL_VERSION` has
  only ever been `1`. Write it as part of the first genuine "expand" PR
  (see "Schema evolution" above), not before.
- **`apps/web`** (React frontend): **Vitest + React Testing Library** for
  component/interaction tests, mocking `useGameSocket` (NewGamePage,
  GamePage). **Playwright** for a small number of true end-to-end flows
  against the real backend + Redis + browser — currently: create a game, join
  it via the invite link from a second browser context, see it update live
  with no mock anywhere in the stack; and a dropped connection reconnects
  with backoff and resyncs to current state, having missed a live event
  entirely (`reconnect.spec.ts` — force-closes the real `WebSocket` object
  from page context, since Chromium's CDP offline emulation doesn't actually
  interrupt an already-open WS). Extends to tile-turning/word-claiming
  flows once gameplay lands. Keep Playwright coverage minimal — it's the only
  layer where testing across the real WS boundary in a real browser matters,
  not a place to re-test business logic already covered elsewhere. Runs via
  `pnpm test:e2e` in `apps/web`, separate from `pnpm test` — needs Redis
  already running and downloaded browser binaries, neither of which the
  default test run should require.

Vitest is the default runner across every layer (native ESM/TS, already
Vite-native for `apps/web`), so most packages share one tool; testcontainers and
Playwright are added only where a layer genuinely needs a real Redis or a real
browser.

## Design system

Sourced from a Claude Design export (`design-system/`) — not invented by
engineering. Key constraints worth respecting when building `apps/web`:

- Typographic wordmark only, no logo asset.
- IBM Plex Mono (display/headings/numeric: scores, timers, tile letters), IBM Plex
  Sans (body/UI labels).
- Palette: warm paper background, near-black ink, one accent green, muted gold for
  scores, restrained — no gradients.
- Lucide icon set, single-color, 20px/1.5px stroke.
- Tone: dry-witty, second person, sentence case, no exclamation points as a crutch.
- The design export already includes a working (localStorage-mocked) prototype of
  gameplay logic — useful as a reference for exact state shapes and interaction
  patterns, but it is a design prototype, not production code, and does not
  implement the full word-formability rules above (only simple single-word steals).
- **`design-system/` is historical reference, not a build dependency.** Tokens are
  copied from `design-system/_ds/tokens/` into `apps/web/src/styles/` once, at
  implementation time — `apps/web` never imports live from `design-system/` at
  build time. `--player-7`/`--player-8` aren't used by any current screen but are
  intentionally reserved for player counts beyond what's built today — keep them.
  Worth checking whether the IBM Plex Mono/Sans 500 weight and Sans 400 weight
  (imported via Google Fonts, but only 600/700 actually render anywhere in the
  current screens) can be trimmed from the font `@import` — real bandwidth
  savings if genuinely unused, but confirm before dropping.

## Game-end condition

Turning over the last tile is NOT the end condition — words can still be formed/
stolen after the bank is empty. Real-life play ends by informal player consensus,
which is too heavyweight to build for MVP.

**MVP default**: once `bankCount == 0`, start an idle countdown (60–90s,
configurable) stored as game state, reset to full every time a `WordPlayed` event
is accepted. If it expires with no plays, the game auto-ends. Same
deadline-in-Redis pattern as the turn timer, just gated on bank-empty and reset on
plays instead of on turns. Chosen as a simple technical proxy for "the table
agrees nothing more can be formed," without an explicit voting/consensus mechanic.
Swappable later for an explicit "any player can call it" or "all players confirm"
mechanic without touching anything else.

## Working conventions

- **Check documentation when a user-story issue closes or changes status.**
  Whenever work closes (or otherwise changes the status of) a user-story
  GitHub issue, check as part of that same piece of work whether `README.md`
  (Status/Stack/Getting started), `docs/decisions.md` (if a real architecture
  or design tradeoff was made along the way — new sections there follow the
  existing Decision/Alternatives/Why format), or this file need updating too.
  Docs that drift silently from what's actually built are worse than no docs.
- **Commit messages**: a single gitmoji (https://gitmoji.dev/) matching the
  change's nature, followed by a plain imperative-sentence subject and body.
  No Conventional Commits-style scope prefixes (`feat:`, `fix:`, `docs:`,
  etc.) and no ticket/issue numbers.
- **Track user stories and open follow-ups/todos as GitHub issues, not in
  CLAUDE.md or docs/\*.md.** As of 2026-08-18, non-trivial deferred work (a
  design decision not yet made, a known gap, a planned-but-not-started piece
  of work) gets filed as a GitHub issue on this repo rather than appended to
  this file's "Still open" section or scattered through docs/decisions.md.
  Reason: md-file todo lists silently drift out of sync with what's
  actually been resolved (see the removed "Still open / not yet decided"
  section below, which had at least one stale entry describing already-shipped
  work as still open) and don't get the status/labels/close-on-resolve
  workflow a real issue tracker gives for free. As of 2026-08-23, this also
  covers product-scope user stories: `docs/user-stories.md` was the
  canonical backlog until then, but is now archived, frozen, at
  `docs/archive/user-stories.md` — a historical record of what shipped
  pre-cutover, not a living doc. New stories are filed as GitHub issues
  directly, no separate mirroring step.
- **Report bugs, not rejections.** When adding an error path, decide which
  side of that line it's on before wiring it up. A domain rejection —
  anything that ends in `sendError` with a code the player is meant to see
  (`NotAWord`, `NoDecomposition`, `NotYourTurn`, `RateLimited`, ...) — is
  the state machine working, gets no `reportError`, and would otherwise put
  dozens of events per game into the error tracker and bury the real ones.
  Report unexpected throws, infra faults (Redis, Postgres, Clerk
  verification _throwing_ rather than returning null), and states that
  shouldn't be reachable; use `reportWarning` for the in-between cases that
  aren't thrown errors but shouldn't be happening. Anything that can fire on
  a loop needs a `dedupeKey`. See docs/decisions.md "Error tracking: Sentry
  behind a `reportError` wrapper".
- **Test-driven development.** When picking up a user-story GitHub issue, or
  any task involving non-trivial logic (not glue code or config), write a
  failing test first, make it pass with the minimum code, then refactor
  (red-green-refactor). Applies especially to `packages/game`'s decomposition
  search and the Lua scripts in `packages/redis` — see "Testing strategy"
  above — where correctness bugs are the costliest and least visible if
  untested.
- **A `pre-push` git hook (`simple-git-hooks`, configured in the root
  `package.json`'s `simple-git-hooks` key) runs `pnpm lint && pnpm
format:check && pnpm typecheck && pnpm test` before every push** — the
  same four checks CI gates on, run locally first so a red build never
  reaches `main`. Installed automatically via the root `postinstall`
  script, so a fresh `pnpm install` wires it up with no extra step.
  Deliberately pre-push, not pre-commit: commits stay fast and frequent,
  while nothing leaves the machine unchecked. Skippable with
  `SKIP_SIMPLE_GIT_HOOKS=1 git push` for a genuine emergency, but treat
  that as an escape hatch, not a habit. Superseded relying on
  documentation alone (this section previously just asked people to
  remember to run `pnpm format:check`) after that approach let a plain
  Prettier drift reach `main` and break CI on an otherwise-passing commit
  — see docs/decisions.md "Pre-push git hooks over documentation-only
  convention" for the fuller history.
- **Assume local dev services (Node server, web dev server, Redis) are
  already running, and check before starting any of them.** The happy path
  is that they're up in a separate terminal with hot reload active, so an
  edit under `apps/server`/`apps/web`/`packages/*` takes effect without a
  restart — don't reflexively run `pnpm dev`/`docker compose up`/etc. as
  part of making a change. Check first (e.g. `lsof -i` on the relevant
  port, or `docker compose ps` for Redis/Postgres/the server, which now
  all run via the root `docker-compose.yml`) and only start something
  that's actually down. This isn't just tidiness: leftover processes from
  Claude-started dev servers have previously accumulated as orphaned,
  never-killed background processes. If you do start something because it
  genuinely wasn't running, say so, and prefer a foreground/tracked run you
  can cleanly stop over a fire-and-forget background one. If a running
  service needs to be **stopped or restarted** (not started from cold) —
  e.g. to pick up an env var change, a dependency install, or something hot
  reload can't handle — don't kill/restart it yourself; prompt the user to
  do so and wait, since it's their terminal/process to control.

## Still open / not yet decided

Tracked as GitHub issues, not maintained as prose here (see "Working
conventions" above) — check the repo's open issues rather than assuming
this list is current. As of 2026-08-25:

- Redis HA approach and timing — anagrabble#3
- Dictionary prefix-derivation gap (UNHAPPY vs. HAPPY) — anagrabble#4
- Reconnect/mid-game-join history panel backfill — anagrabble#5
- Post-bank-empty idle timeout not wired to `GameConfig` — anagrabble#6
- Account avatar: Clerk `UserButton`/`UserAvatar` vs. initial-only — anagrabble#7
- Clerk transactional email branding — anagrabble#8
- Presence timing (`PRESENCE_STALE_MS`/`PING_INTERVAL_MS`) ops-tunability — anagrabble#9
- Migrate off `@clerk/react/legacy` hooks to the Future API — anagrabble#1

Auth context worth keeping here since it's load-bearing for anything
touching identity, not just an open question: sign-up/log-in is built
against Clerk (`apps/web` only — see docs/decisions.md "Auth provider:
Clerk, not a hand-rolled `users` table"). Gameplay requires being signed
in — no anonymous play — and player identity is the Clerk user id/account
name, not a local stub (`playerIdentity.ts` is gone). See docs/decisions.md
"Player identity: Clerk id, no anonymous play". Every identity-bearing WS
command (`JoinGame`/`StartGame`/`TurnTile`/`SubmitWord`) derives its actor
from the connection's verified `meta.clerkUserId` (`src/auth.ts`'s
`resolveActingPlayerId`) rather than trusting the command payload's
`playerId`/`hostId` — see docs/decisions.md "Command identity: derived
from the Clerk session, not client-supplied". `CreateGame` (REST, see
docs/decisions.md "CreateGame as a REST endpoint") derives its actor
from the request's Bearer token instead, via the same `authenticate()`
pattern as `/stats`/`/settings`. `CLERK_SECRET_KEY` is required (server
throws on startup without it). `hostId`/`playerId` have been removed from
the wire protocol entirely (`PROTOCOL_VERSION` 2) — the server never reads
a client-claimed actor id at all, only the verified session. Durable
Postgres history is now written end to end (`apps/server/src/index.ts`
inserts `games`/`word_plays` rows and updates `game_players` on
`StartGame`/`SubmitWord`/`EndGame`), so games/stats do persist against the
Clerk id. `apps/web` never imports `@clerk/react` directly — it goes
through `src/auth/`, which swaps in a fully offline mock provider for
local dev (`VITE_AUTH_MODE=mock`) so `pnpm dev` needs no internet
connection. `apps/server` has a matching `AUTH_MODE=mock` counterpart so
gameplay commands work end to end without reaching real Clerk. See
docs/decisions.md "Local dev auth: mock provider, not a Clerk sandbox".
