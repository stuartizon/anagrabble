# Anagrabble

A real-time multiplayer word game. Letter tiles are turned over one at a time on a
rotating turn timer; any player, at any time, can claim a word formable from the
revealed tiles, or steal existing claimed words by extending or combining them
(CAT + S → CAST).

## Stack

| Layer           | Choice                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend         | Stateless Node.js service built with TypeScript, [fastify](https://fastify.dev/), [ws](https://github.com/websockets/ws), [ioredis](https://github.com/redis/ioredis) |
| Frontend        | React SPA built with Vite                                                                                                                                             |
| Live game state | Redis — authoritative; see `docs/redis-schema.md` for the key/shape convention                                                                                        |
| Durable history | Postgres; see `docs/postgres-schema.md` for the schema                                                                                                                |
| Auth            | Clerk — see `docs/decisions.md` "Auth provider"                                                                                                                       |
| Monorepo        | pnpm workspaces                                                                                                                                                       |
| Testing         | Vitest (per-package; see `CLAUDE.md` "Testing strategy")                                                                                                              |

See `CLAUDE.md` for the full architecture rationale and conventions, and
`docs/decisions.md` for the detailed reasoning behind each choice (why Redis over
an actor model, why Railway over AWS, why these deployment/hosting picks, etc.).

## Getting started

To start the backend server, the frontend dev server, Redis and Postgres:

```bash
docker compose up -d
```

Open `http://localhost:5173`, create a game, and start playing.

There are two additional containers which provide graphical interface tools:

- Adminer (Postgres - `http://localhost:8081`)
- RedisInsight (Redis - `http://localhost:8082`).

These aren't part of the default profile; to spin these up, instead run:

```bash
docker compose --profile tools up -d
```

## Environments

| Environment | Frontend                                          | Server / API                                              |
| ----------- | ------------------------------------------------- | --------------------------------------------------------- |
| Dev         | [dev.anagrabble.com](https://dev.anagrabble.com/) | [api-dev.anagrabble.com](https://api-dev.anagrabble.com/) |
| Production  | [www.anagrabble.com](https://www.anagrabble.com/) | [api.anagrabble.com](https://api.anagrabble.com/)         |

Consoles:

- Neon (Postgres): https://console.neon.tech/app/projects/broad-snow-98083442
- Railway (backend + Redis): https://railway.com/project/e8a1a8d9-0c14-4245-ba2c-55542c4793b5
- Cloudflare Pages (frontend): https://dash.cloudflare.com/fe4f7d1b36caddb6f55829a6e485c3d1/pages/view/anagrabble

These console links require login credentials to access, so they're safe to
list in this public repo.

## Repo structure

```
├── apps/
│   ├── server/             # Stateless backend
│   └── web/                # Frontend application
├── packages/
│   ├── game/               # Domain logic (word resolution, steal rules, dictionary validation)
│   ├── protocol/           # Shared TS types (commands, events, WS message shapes)
│   └── redis/              # Lua scripts + typed Redis client wrapper
├── infrastructure/
│   └── dev.Dockerfile      # Toolchain image for local dev used by docker compose
├── design-system/          # Design export (reference only, not a build dependency)
├── docs/                   # Decision records, user stories, Redis and Postgres schemas
└── docker-compose.yml      # Local dev stack
```

## Authentication

For local development we use a mock auth mode so we don't need a Clerk account.

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
`CLERK_PUBLISHABLE_KEY` in `apps/web/public/env.js`, and on the backend
side, `export CLERK_SECRET_KEY=...` in your shell before `docker compose
up` (it's read from the host environment, not a `.env` file — see
`${CLERK_SECRET_KEY:-}` in `docker-compose.yml`) and change `AUTH_MODE:
mock` to blank in that same file for the `server` service:

- Create a free application at [clerk.com](https://clerk.com) (or reuse an
  existing one).
- Dashboard → API Keys → copy the **Publishable key** into
  `CLERK_PUBLISHABLE_KEY` (in `apps/web/public/env.js`) and the **Secret
  key** into `CLERK_SECRET_KEY`. Both are required outside mock mode — each
  side throws on startup without its key.
- Both keys must come from the **same** Clerk application. A mismatch fails
  silently at connect time — the socket just never verifies — though it
  surfaces immediately after: every command comes back `Unauthorized` since
  the connection never got a verified identity.
- Restart both (`docker compose up -d --build web server`) after changing
  `VITE_AUTH_MODE` or `CLERK_SECRET_KEY` — both are read at process
  startup. `public/env.js` isn't: it's a static file the dev server
  re-reads on every page load, so editing `CLERK_PUBLISHABLE_KEY` there
  just needs a browser refresh.

## Environment variables

The backend server is configured with the following environment variables:

- DATABASE_URL - the connection string for Postgres
- REDIS_URL - the connection string for Redis
- PORT - the port to start the service on
- AUTH_MODE - if set to mock, then it supresses token signature checks. For local dev only; don't set in deployed environments
- CLERK_SECRET_KEY - the secret key provided by Clerk for this environment. Not required if in mock AUTH_MODE
- WEB_ORIGIN - location of the front end, needed for CORS support

The frontend is configured with the following variables:

- API_URL - the backend server's HTTP origin for REST endpoints
- WS_URL - the backend server's WS origin
- CLERK_PUBLISHABLE_KEY - the safe to expose key provided by Clerk for this environment. Not required if in mock AUTH_MODE

Unlike the backend, the frontend does not run on a server when deployed. It's just a bunch of assets in a bucket. So these environment variables are provided via an env.js file uploaded to the bucket alongside.

There is also a build time key for using mock auth, again in local dev only.

- VITE_AUTH_MODE - if set to mock, then the frontend makes zero calls to Clerk and login users are provided by local mock data.

If you use the docker compose setup described above, all of this is pre-configured. To run the vite dev server and/or the backend outside of docker, make sure to copy:

- /apps/server/.env.example → /apps/server/.env
- /apps/web/.env.example → /apps/web/.env
- /apps/web/public/env.example.js → /apps/web/public/env.js

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
  `seed-mock-stats`, and the `tools`-profile containers aren't used by this
  path, no need to bring them up).
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

Backend + Redis: Railway. Postgres: Neon. Frontend: Cloudflare Pages. See
`docs/decisions.md` for why.
