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
| Error tracking  | Sentry — optional, off without a DSN; see `docs/decisions.md` "Error tracking: Sentry behind a `reportError` wrapper"                                                       |
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
- `SENTRY_DSN` - optional; error reporting is disabled entirely when unset, which is the default locally and in tests
- `SENTRY_ENVIRONMENT` - optional; `development` or `production`, the tag that separates the two environments inside one Sentry project

The frontend is configured with the following variables:

- `API_URL` - the backend server's HTTP origin for REST endpoints
- `WS_URL` - the backend server's WS origin
- `CLERK_PUBLISHABLE_KEY` - the safe to expose key provided by Clerk for this environment. Not required if in mock auth mode
- `SENTRY_DSN` - optional; safe to expose (a DSN only permits writing events). Leave empty locally and the app never contacts Sentry
- `SENTRY_ENVIRONMENT` / `RELEASE` - optional; set by CI per environment, the latter to the deployed commit SHA

Unlike the backend, the frontend does not run on a server when deployed. It's just a bunch of assets in a bucket. So these environment variables are provided via an env.js file uploaded to the bucket alongside.

There is also a build time key for using mock auth, again in local dev only.

- `VITE_AUTH_MODE` - if set to mock, then the frontend makes zero calls to Clerk and login users are provided by local mock data.

If you use the docker compose setup described above, all of this is pre-configured. To run the vite dev server and/or the backend outside of docker, make sure to copy:

- `/apps/server/.env.example → /apps/server/.env`
- `/apps/web/.env.example → /apps/web/.env`
- `/apps/web/public/env.example.js → /apps/web/public/env.js`

## Testing

All development work in this repo was undertaken using a TDD with red-green refactoring strategy.

To test locally, make sure you have `pnpm` installed and run:

```bash
pnpm test
```

Each package has unit tests written in Vitest, including:

- Component tests with React testing library for the frontend
- Tests against Redis and Postgres test containers for the server
- Property-based tests for the tile bag and word-decomposition in `packages/game`
- Redis integration tests for the Lua scripts in `packages/redis`

There is also a full end-to-end suite of tests run with Playwright spinning up a real backend, Redis, Postgres and frontend. Make sure to have the Redis and Postgres containers up, `AUTH_MODE=mock` set in `apps/server/.env`, and the Playwright browser installed. As these are slower to run, they aren't part of the command above, but can be run via:

```bash
cd apps/web && pnpm test:e2e
```

All of these tests are used in the CI to gate deploys.

## Contributing / working on this repo

Read `CLAUDE.md` first — it documents the architecture decisions and
conventions (especially the expand/contract rule for anything in
`packages/protocol`, and the client/server split for word-resolution logic)
that any change should follow. `docs/decisions.md` has the fuller reasoning
if you're wondering why something was built a particular way.
