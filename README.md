# Anagrabble

A real-time multiplayer word game. Letter tiles are turned over one at a time on a
rotating turn timer; any player, at any time, can claim a word formable from the
revealed tiles, or steal existing claimed words by extending or combining them
(CAT + S → CAST).

## Status

Lobby, tile-turning, and word submission/stealing are all done end to end:
create a game, share an invite link, join it, see connected players live,
turn tiles from the bank (auto-advancing if a turn timer expires), claim/
steal words, see a running play history (desktop-only), and the game
auto-ends after a 60s idle period once the bank runs dry, landing on a
ranked game-over summary — through real WebSocket/Redis state (no mocked
data), verified in a real browser against the real backend. See
`docs/user-stories.md` for exact scope and what's still missing (player
stats across games, account/settings persistence). Sign-up/log-in
(email/password + Google, via Clerk, including password reset) gates
gameplay — creating or joining a game requires being signed in, and
player identity is the Clerk user id/account name, not a local stub. See
docs/decisions.md "Auth provider" for why Clerk over a hand-rolled
`users` table, and "Player identity: Clerk id, no anonymous play" for
the identity/gating details. Durable Postgres history (games, word
plays, final scores) is now written after every accepted `StartGame`/
`SubmitWord`/`EndGame`, linked to that Clerk id — see
`docs/postgres-schema.md`. Not yet built: a UI to actually view that
history/stats across games (`docs/user-stories.md`).

## Stack

|                 |                                                                                |
| --------------- | ------------------------------------------------------------------------------ |
| Backend         | Node.js + TypeScript, `ws` (WebSocket), Redis (`ioredis`)                      |
| Live game state | Redis — authoritative; see `docs/redis-schema.md` for the key/shape convention |
| Durable history | Postgres, written after Redis accepts a move                                   |
| Frontend        | Vite + React, `react-router-dom`                                               |
| Auth            | Clerk (`@clerk/react`) — see `docs/decisions.md` "Auth provider"               |
| Monorepo        | pnpm workspaces                                                                |
| Testing         | Vitest (per-package; see `CLAUDE.md` "Testing strategy")                       |

See `CLAUDE.md` for the full architecture rationale and conventions, and
`docs/decisions.md` for the detailed reasoning behind each choice (why Redis over
an actor model, why Railway over AWS, why these deployment/hosting picks, etc.).

## Repo structure

```
apps/server/     Stateless WebSocket/HTTP gateway
apps/web/        Frontend — React + Vite
packages/game/   Domain logic: word resolution, steal rules, dictionary validation
packages/protocol/  Shared TS types: commands, events, WS message shapes
packages/redis/  Lua scripts + typed Redis client wrapper
infrastructure/  docker-compose.yml for local dev
design-system/   Claude Design export — reference only, not a build dependency
docs/            decisions.md, user-stories.md, redis-schema.md
```

## Getting started

Requires Node 22.22.2+, pnpm, and Docker.

```bash
pnpm install

# copy env templates, then fill them in — see "Environment variables" below
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env

# start Redis + Postgres locally
docker compose -f infrastructure/docker-compose.yml up redis postgres -d

# run the backend
pnpm dev:server

# run the frontend, in another terminal
pnpm dev:web
```

### Environment variables

Each app reads local config from its own `.env` (gitignored; see
`apps/server/.env.example` / `apps/web/.env.example` for the full list with
comments). Most values already have a working local default — Redis URL,
ports — and don't need editing. The one that does need a real value before
anything will run is Clerk:

- Create a free application at [clerk.com](https://clerk.com) (or reuse an
  existing one).
- Dashboard → API Keys → copy the **Publishable key** into `apps/web/.env`'s
  `VITE_CLERK_PUBLISHABLE_KEY`. Not optional — the frontend throws on
  startup without it.
- Copy the **Secret key** into `apps/server/.env`'s `CLERK_SECRET_KEY`. Also
  not optional — the backend throws on startup without it, since every
  identity-bearing command is authorized against a verified Clerk session
  (see `docs/decisions.md` "Backend Clerk session verification").
- Both keys must come from the **same** Clerk application. A mismatch fails
  silently at connect time — the socket just never verifies — though it
  surfaces immediately after: every command comes back `Unauthorized` since
  the connection never got a verified identity.

Backend listens on `:8080`, frontend on `:5173`. The frontend expects
`VITE_WS_URL` (defaults to `ws://localhost:8080`) to reach the backend.

Open `http://localhost:5173`, create a game, then open the invite link
(shown in the lobby) in a second tab/browser to join it — players should
appear on both sides live.

To build and run everything via Docker instead:

```bash
docker compose -f infrastructure/docker-compose.yml up
```

Note the `server` service reads `CLERK_SECRET_KEY` from your host shell
environment (`${CLERK_SECRET_KEY:-}` in `docker-compose.yml`), not from
`apps/server/.env` — `export CLERK_SECRET_KEY=...` first, or put it in
`infrastructure/.env`, if you're using this all-in-Docker path.

## Testing

```bash
pnpm test
```

Runs each package's unit/component/integration test suite: Vitest unit and
property-based (fast-check) tests for the tile bag and word-decomposition
search in `packages/game`, real-Redis integration tests for the
`apply_turn_tile`/`apply_submit_word` Lua scripts in `packages/redis` and for
the lobby/game modules in `apps/server` (spins up a container via
testcontainers — needs Docker), and mocked component tests for `apps/web`.

```bash
cd apps/web && pnpm test:e2e
```

Runs the Playwright end-to-end suite against the real backend + Redis +
browser (create a game, join via the invite link, see it live) — not part
of `pnpm test` since it needs Redis already running (`docker compose -f
infrastructure/docker-compose.yml up redis -d`) and downloaded browser
binaries (`pnpm --filter @anagrabble/web exec playwright install
chromium`).

See `CLAUDE.md` "Testing strategy" for the framework chosen per layer, and
"Test-driven development" for the red-green-refactor convention this repo
follows when picking up new work.

## Contributing / working on this repo

Read `CLAUDE.md` first — it documents the architecture decisions and
conventions (especially the expand/contract rule for anything in
`packages/protocol`, and the client/server split for word-resolution logic)
that any change should follow. `docs/decisions.md` has the fuller reasoning
if you're wondering why something was built a particular way.

## Deployment

Backend + Redis: Railway. Postgres: Neon. Frontend: Vercel. See
`docs/decisions.md` for why.
