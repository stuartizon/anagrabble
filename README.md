# Anagrabble

A real-time multiplayer word game. Letter tiles are turned over one at a time on a
rotating turn timer; any player, at any time, can claim a word formable from the
revealed tiles, or steal existing claimed words by extending or combining them
(CAT + S → CAST).

## Environments

| Environment | Frontend                                          | Server / API                                              | Postgres (Neon)                                                                                      | Backend + Redis (Railway)                                                                                                      |
| ----------- | ------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Dev         | [dev.anagrabble.com](https://dev.anagrabble.com/) | [api-dev.anagrabble.com](https://api-dev.anagrabble.com/) | [console](https://console.neon.tech/app/projects/broad-snow-98083442/branches/br-mute-rain-b2i73gf5) | [console](https://railway.com/project/e8a1a8d9-0c14-4245-ba2c-55542c4793b5?environmentId=8d2e81c0-82fe-4524-b308-28f0a7a5d0f4) |
| Production  | —                                                 | —                                                         | —                                                                                                    | —                                                                                                                              |

Connection secrets (passwords, API keys) live outside this file — the Neon
and Railway console links above are auth-gated rather than printing raw
connection properties, since this repo is public.

## Status

Lobby, tile-turning, and word submission/stealing are all done end to end:
create a game, share an invite link, join it, see connected players live,
turn tiles from the bank (auto-advancing if a turn timer expires), claim/
steal words, see a running play history (desktop-only), and the game
auto-ends after a 60s idle period once the bank runs dry, landing on a
ranked game-over summary — through real WebSocket/Redis state (no mocked
data), verified in a real browser against the real backend. See
`docs/user-stories.md` for exact scope and what's still missing
(connection-drop resync, full mobile playability). Sign-up/log-in
(email/password + Google, via Clerk, including password reset) gates
gameplay — creating or joining a game requires being signed in, and
player identity is the Clerk user id/account name, not a local stub. See
docs/decisions.md "Auth provider" for why Clerk over a hand-rolled
`users` table, and "Player identity: Clerk id, no anonymous play" for
the identity/gating details. Durable Postgres history (games, word
plays, final scores) is now written after every accepted `StartGame`/
`SubmitWord`/`EndGame`, linked to that Clerk id — see
`docs/postgres-schema.md`. A player can view their own stats across past
games at `/stats` (games played, wins, win rate, average/highest score,
longest word, win streak, lifetime totals, average game length),
computed from that same durable history — see `docs/user-stories.md`. A
player can also set interface language/sound/haptics preferences at
`/settings`, persisted per-account in Postgres (`player_settings`).

## Stack

|                 |                                                                                |
| --------------- | ------------------------------------------------------------------------------ |
| Backend         | Node.js + TypeScript, Fastify (REST) + `ws` (WebSocket), Redis (`ioredis`)     |
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
docker-compose.yml  Local dev stack — Redis, Postgres, the backend server, a
                     one-shot mock-stats seed, and Adminer
apps/server/     Stateless WebSocket/HTTP gateway
apps/web/        Frontend — React + Vite
packages/game/   Domain logic: word resolution, steal rules, dictionary validation
packages/protocol/  Shared TS types: commands, events, WS message shapes
packages/redis/  Lua scripts + typed Redis client wrapper
infrastructure/  dev.Dockerfile — the toolchain image docker-compose.yml builds
design-system/   Claude Design export — reference only, not a build dependency
docs/            decisions.md, user-stories.md, redis-schema.md
```

## Getting started

Requires Node 22.22.2+, pnpm, and Docker.

```bash
pnpm install

# copy the web app's env template, then fill it in if needed — see
# "Environment variables" below
cp apps/web/.env.example apps/web/.env

# start everything — Redis, Postgres, the backend server, and the frontend
# dev server, already wired to a mock auth mode that needs no real Clerk
# account — via Docker
docker compose up -d
```

The `server` and `web` containers bind-mount this checkout and run `tsx
watch`/`vite` respectively, so editing `apps/server`, `apps/web`, or
`packages/*` reloads live — no rebuild needed. Only rebuild (`docker compose
up -d --build`) when the toolchain itself changes (Node/pnpm version, or
`infrastructure/dev.Dockerfile`).

### Environment variables

`apps/web` reads local config from its own `.env` (gitignored; see
`apps/web/.env.example` for the full list with comments) — `VITE_WS_URL`
(`ws://localhost:8080` for local dev) to reach the backend's WebSocket, and
`VITE_API_URL` (`http://localhost:8080`) for its REST endpoints (`/stats`
and beyond); neither has a built-in default, both throw on startup if
unset.

**Auth defaults to a fully offline mock** — `docker-compose.yml` sets the
backend's `AUTH_MODE=mock`, and `VITE_AUTH_MODE=mock` is `apps/web/.env.example`'s
default too, so the whole create/join/play loop works with zero calls to
real Clerk, no Clerk application needed. See `docs/decisions.md` "Local dev
auth: mock provider, not a Clerk sandbox".

The mock roster (Alice/Bob/Charlie/Diana) starts with no history, so
`/stats` is empty for all of them against a fresh database. The
`seed-mock-stats` container (part of `docker compose up`) backfills a
handful of completed games for Alice, Bob, and Charlie automatically —
Diana is left with none on purpose, to check the empty state. See
`packages/postgres/scripts/seed-mock-stats.ts`. Safe to rerun (idempotent).

To instead run against a real (dev) Clerk instance — e.g. to sanity-check
something mock auth can't exercise, like actual sign-up/password-reset
flows — blank `VITE_AUTH_MODE` in `apps/web/.env` and fill in
`VITE_CLERK_PUBLISHABLE_KEY`, and on the backend side, `export
CLERK_SECRET_KEY=...` in your shell before `docker compose up` (it's read
from the host environment, not a `.env` file — see `${CLERK_SECRET_KEY:-}`
in `docker-compose.yml`) and change `AUTH_MODE: mock` to blank in that same
file for the `server` service:

- Create a free application at [clerk.com](https://clerk.com) (or reuse an
  existing one).
- Dashboard → API Keys → copy the **Publishable key** into
  `VITE_CLERK_PUBLISHABLE_KEY` and the **Secret key** into
  `CLERK_SECRET_KEY`. Both are required outside mock mode — each side
  throws on startup without its key.
- Both keys must come from the **same** Clerk application. A mismatch fails
  silently at connect time — the socket just never verifies — though it
  surfaces immediately after: every command comes back `Unauthorized` since
  the connection never got a verified identity.
- Restart both (`docker compose up -d --build web server`) after changing
  any of these.

Open `http://localhost:5173`, create a game, then open the invite link
(shown in the lobby) in a second tab/browser to join it — players should
appear on both sides live.

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
of `pnpm test`, and not currently run in CI either (`.github/workflows/
ci.yml` only runs `pnpm test`, which doesn't include this). Playwright's
own `webServer` config starts the backend and frontend itself
(`pnpm --filter @anagrabble/server dev` / `... @anagrabble/web dev`,
reusing them if already running), independent of the `server` container in
`docker-compose.yml` — so this needs:

- Just `docker compose up redis postgres -d` (the dockerized `server`,
  `seed-mock-stats`, and `adminer` aren't used by this path, no need to
  bring them up).
- `apps/server/.env` set up (`cp apps/server/.env.example apps/server/.env`,
  then set `AUTH_MODE=mock` in it — blank by default in the template),
  since Playwright's spawned server reads its config from that file, not
  from `docker-compose.yml`.
- Downloaded browser binaries: `pnpm --filter @anagrabble/web exec
playwright install chromium`.

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
