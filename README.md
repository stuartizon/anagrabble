# Anagrabble

A real-time multiplayer word game. Letter tiles are turned over one at a time on a
rotating turn timer; any player, at any time, can claim a word formable from the
revealed tiles, or steal existing claimed words by extending or combining them
(CAT + S → CAST).

## Getting started

To start the backend server, the frontend dev server, Redis and Postgres:

```bash
docker compose up -d
```

Open <http://localhost:5173>, create a game, and start playing.

There are two additional containers which provide graphical interface tools:

- Adminer (Postgres - <http://localhost:8081>)
- RedisInsight (Redis - <http://localhost:8082>).

These aren't part of the default profile; to spin these up, instead run:

```bash
docker compose --profile tools up -d
```

## Stack

| Layer           | Choice                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend         | Stateless Node.js service built with TypeScript, [fastify](https://fastify.dev/), [ws](https://github.com/websockets/ws), [node-redis](https://github.com/redis/node-redis) |
| Frontend        | React SPA built with Vite                                                                                                                                                   |
| Live game state | Redis — authoritative; see `docs/redis-schema.md` for the key/shape convention                                                                                              |
| Durable history | Postgres; see `docs/postgres-schema.md` for the schema                                                                                                                      |
| Authentication  | Clerk — see [Authentication](#authentication)                                                                                                                               |
| Monorepo        | pnpm workspaces                                                                                                                                                             |
| Testing         | Vitest (per-package; see `CLAUDE.md` "Testing strategy")                                                                                                                    |

The backend and Redis are hosted on Railway. Postgres is on Neon. The frontend is on Cloudflare Pages.

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

## Environments

| Environment | Frontend                     | Server                           |
| ----------- | ---------------------------- | -------------------------------- |
| Dev         | <https://dev.anagrabble.com> | <https://api-dev.anagrabble.com> |
| Production  | <https://www.anagrabble.com> | <https://api.anagrabble.com>     |

Consoles:

- Neon (Postgres): <https://console.neon.tech/app/projects/broad-snow-98083442>
- Railway (backend + Redis): <https://railway.com/project/e8a1a8d9-0c14-4245-ba2c-55542c4793b5>
- Cloudflare Pages (frontend): <https://dash.cloudflare.com/fe4f7d1b36caddb6f55829a6e485c3d1/pages/view/anagrabble>

These console links require login credentials to access, so they're safe to
list in this public repo.

## Authentication

For authentication, this app uses Clerk to provide a ready-to-use login system instantly so we focus on building the actual app instead of wasting time writing security code. Two types of login are currently supported: email/password and Google OAuth. Each Clerk environment provides a publishable key to identify the app safely in the browser, and a secret key to verify the authentication with Clerk.

For local development, we bypass Clerk entirely and use local mocks. This allows us to run the full stack offline, and lets AI agents test out flows without requiring real logon credentials. This is enabled via `VITE_AUTH_MODE=mock` on the frontend, and `AUTH_MODE=mock` on the backend. These are configured by default in the docker compose setup, but if you want to run the frontend or backend outside of docker, then ensure these variables are set accordingly to use the local mocks, or setup Clerk with appropriate publishable key and secret key.

The mock authentication provides four users: Alice/Bob/Charlie/Diana and adds dedicated login buttons for each at the top of the login page. The regular login/signup/oauth flows are disabled client-side, rejecting before any network call, so that these buttons become the only way of logging in when mocks are enabled. A script is provided to seed some mock data in the database for these users (so that the stats page shows some meaningful content). This process is run by default as part of the default docker compose config, and is harmless even if running locally against a real Clerk environment.

## Environment variables

The backend server is configured with the following environment variables:

- `DATABASE_URL` - the connection string for Postgres
- `REDIS_URL` - the connection string for Redis
- `PORT` - the port to start the service on
- `AUTH_MODE` - if set to mock, then it supresses token signature checks. For local dev only; don't set in deployed environments
- `CLERK_SECRET_KEY` - the secret key provided by Clerk for this environment. Not required if in mock auth mode
- `WEB_ORIGIN` - location of the front end, needed for CORS support

The frontend is configured with the following variables:

- `API_URL` - the backend server's HTTP origin for REST endpoints
- `WS_URL` - the backend server's WS origin
- `CLERK_PUBLISHABLE_KEY` - the safe to expose key provided by Clerk for this environment. Not required if in mock auth mode

Unlike the backend, the frontend does not run on a server when deployed. It's just a bunch of assets in a bucket. So these environment variables are provided via an env.js file uploaded to the bucket alongside.

There is also a build time key for using mock auth, again in local dev only.

- `VITE_AUTH_MODE` - if set to mock, then the frontend makes zero calls to Clerk and login users are provided by local mock data.

If you use the docker compose setup described above, all of this is pre-configured. To run the vite dev server and/or the backend outside of docker, make sure to copy:

- `/apps/server/.env.example → /apps/server/.env`
- `/apps/web/.env.example → /apps/web/.env`
- `/apps/web/public/env.example.js → /apps/web/public/env.js`

## Testing

```bash
pnpm test
```

Runs each package's unit/component/integration test suite: Vitest unit and
property-based (fast-check) tests for the tile bag and word-decomposition
search in `packages/game`, real-Redis integration tests for the
`apply_turn_tile`/`apply_submit_word` Lua scripts in `packages/redis` and for
the gameSession/game modules in `apps/server` (spins up a container via
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
