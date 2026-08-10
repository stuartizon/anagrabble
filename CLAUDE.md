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
apps/server/     Node.js + TypeScript — stateless WebSocket/HTTP gateway
apps/web/        Frontend — React + Vite, fed by the Claude Design export in design-system/
packages/game/   Domain logic: word resolution, steal rules, dictionary validation
packages/protocol/ Shared TS types: commands, events, WS message shapes
packages/redis/  Lua scripts + typed Redis client wrapper
infrastructure/  docker-compose.yml for local dev (Node + Redis + Postgres)
design-system/   Claude Design export (tokens, components, screen prototypes)
docs/            decisions.md, user-stories.md, redis-schema.md
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
  Supabase) for free-tier scale-to-zero Postgres, separate from Railway.
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
- **Frontend**: Vercel (or Cloudflare Pages) — static/CDN hosting, free tier, kept
  separate from Railway since there's no reason to serve static assets from a
  metered compute container.
- Everything is Dockerized and cloud-agnostic in principle; Railway is a deployment
  choice, not an architectural dependency. AWS remains the fallback if/when real HA
  or infra control requirements emerge (see docs/decisions.md for the full
  Railway-vs-AWS-vs-Fly-vs-self-hosted comparison).

## Game rules — the parts that affect protocol design

- **Tile turning is turn-based**: only the current player (by rotating index) may
  turn a tile, gated by a per-turn countdown (`turnTimerSec`, configurable 15–60s).
  This is a _different_ concurrency problem than word submission — effectively
  single-writer by construction, but the deadline must still be server-verified,
  never trusted to the client.
- **Word submission/stealing is free-for-all**: any player, any time. This is the
  actual "first wins" race the whole Redis/atomicity design exists for.
- **Playing/stealing a word also transfers the tile-turn**: the submitter
  becomes the current player, same as if they'd turned a tile — see
  docs/decisions.md "Word play transfers the tile-turn" for why this needed
  confirming rather than assuming (the two design references disagreed).
  `apply_submit_word.lua` reassigns `turnPlayerIndex`/`turnDeadline` as part
  of the same atomic mutation.
- **Scoring**: 1 point at `minWordLength`, +1 per letter beyond it — see
  docs/decisions.md "Scoring" for the formula, why (not raw word length),
  and a flagged-but-unsolved tension with future cross-game stats.
- **Turn timer enforcement (MVP decision)**: client-triggered only. Any connected
  client fires `TurnTile` when its local countdown hits zero; the Lua script
  verifies `now >= turnDeadline` server-side regardless of who called it. No
  polling sweep / sorted-set reliability layer for MVP — deliberately deferred
  until real evidence (stalled games) justifies it. Adding it later requires no
  redesign: both paths converge on the same idempotent `apply_turn_tile` call.
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
  - Rationale: backend and frontend deploy independently (Railway + Vercel,
    separate auto-deploy pipelines, no cross-platform ordering guarantee) — a
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
  `apps/server/src/lobby.ts`/`game.ts` for which paths use which), including
  the concurrent-race case: fire two eligible `TurnTile` calls at the same
  script back-to-back right after a deadline passes, assert exactly one
  wins deterministically. The word-submission story will add its own
  script(s) here the same way, covering its own concurrent-race case (two
  overlapping word claims).
- **`apps/server`** (WS/HTTP gateway): **Vitest** integration tests against
  a **real Redis** via `@testcontainers/redis` — idempotency dedup, `seq`
  bumps, and state-machine guards, not mocked, for the same reason as above.
  Covers `lobby.ts` (create/join/leave-game) and `game.ts` (start-game/
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
  LobbyPage). **Playwright** for a small number of true end-to-end flows
  against the real backend + Redis + browser — currently: create a game, join
  it via the invite link from a second browser context, see it update live
  with no mock anywhere in the stack. Extends to tile-turning/word-claiming
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

- **Check documentation when a user story completes or changes status.**
  Whenever work moves a story in `docs/user-stories.md` to `[x]` or `[~]`,
  check as part of that same piece of work whether `README.md` (Status/Stack/
  Getting started), `docs/decisions.md` (if a real architecture or design
  tradeoff was made along the way — new sections there follow the existing
  Decision/Alternatives/Why format), or this file need updating too. Docs
  that drift silently from what's actually built are worse than no docs.
- **Commit messages**: a single gitmoji (https://gitmoji.dev/) matching the
  change's nature, followed by a plain imperative-sentence subject and body.
  No Conventional Commits-style scope prefixes (`feat:`, `fix:`, `docs:`,
  etc.) and no ticket/issue numbers.
- **Test-driven development.** When picking up a user story from
  `docs/user-stories.md`, or any task involving non-trivial logic (not glue
  code or config), write a failing test first, make it pass with the minimum
  code, then refactor (red-green-refactor). Applies especially to
  `packages/game`'s decomposition search and the Lua scripts in
  `packages/redis` — see "Testing strategy" above — where correctness bugs are
  the costliest and least visible if untested.
- **Run `pnpm format:check` before every commit, not just `pnpm lint` and
  `pnpm test`.** There's deliberately no pre-commit hook enforcing this
  locally, so Prettier drift only ever surfaces in CI's `Format check`
  step — a separate command from `Lint`/`Typecheck`/`Test` in the same job
  (`.github/workflows/ci.yml`), easy to skip by running eslint/tsc/vitest
  on changed files and calling it clean without ever running Prettier.
  That gap is exactly how a plain formatting drift once reached `main` and
  broke CI on an otherwise-passing commit.

## Still open / not yet decided

- Whether/when to add the turn-timer polling sweep.
- Redis HA approach and timing of adopting it (Sentinel template vs. staying
  single-instance) — revisit once usage data exists.
- Lobby presence tracking (`pendingLeaves` in `apps/server/src/index.ts`) is
  in-memory and single-process-only — won't survive a reconnect landing on a
  different Node instance. Fine at one server process; revisit before
  running more than one. See docs/decisions.md "Lobby slice" section for the
  fuller reasoning and the two candidate fixes.
- Dictionary derivation data is suffix-only (e.g. UNHAPPY vs. HAPPY isn't
  caught, unlike CATS vs. CAT) — a data-quality gap, not a code limitation;
  `isDerivedFrom` itself has no concept of position. See docs/decisions.md
  "Dictionary source and format"'s second known gap.
- The post-bank-empty idle timeout is hardcoded at 60s in both
  `apply_turn_tile.lua` and `apply_submit_word.lua` — this section's own
  "60–90s, configurable" isn't wired up to `GameConfig` yet. See
  docs/decisions.md "Game-end condition" implementation note.
- Auth: sign-up/log-in is built against Clerk (`apps/web` only — see
  docs/decisions.md "Auth provider: Clerk, not a hand-rolled `users`
  table"), but nothing on `apps/server` verifies a Clerk session yet.
  Creating/joining a game still runs on the local player-identity stub
  (`playerIdentity.ts`), not a signed-in account — gating gameplay on login
  and linking games/stats to a Clerk user id are both still open.
- The header avatar always shows an initial, never Clerk's `UserButton`/
  `UserAvatar` (which would give a real profile photo plus a built-in
  account-management dropdown) — a deliberate call for now, not an
  oversight. See docs/decisions.md "Account avatar" for why, and when it'd
  be worth revisiting.
