# Anagrabble

A real-time multiplayer word game. Letter tiles are turned over one at a time on a
rotating turn timer; any player, at any time, can claim a word formable from the
revealed tiles, or steal existing claimed words by extending or combining them
(CAT + S → CAST).

## Status

Early scaffold. Backend boots (WebSocket handshake + Redis-backed health check);
frontend is a placeholder Vite app. Core gameplay (word submission, stealing,
turn timer) is not yet implemented — see `docs/user-stories.md` for scope.

## Stack

| | |
|---|---|
| Backend | Node.js + TypeScript, `ws` (WebSocket), Redis (`ioredis`) |
| Live game state | Redis — authoritative, atomic Lua scripts enforce move ordering |
| Durable history | Postgres, written after Redis accepts a move |
| Frontend | Vite (React planned, not yet scaffolded — see `CLAUDE.md`) |
| Monorepo | pnpm workspaces |

See `CLAUDE.md` for the full architecture rationale and conventions, and
`docs/decisions.md` for the detailed reasoning behind each choice (why Redis over
an actor model, why Railway over AWS, why these deployment/hosting picks, etc.).

## Repo structure

```
apps/server/     Stateless WebSocket/HTTP gateway
apps/web/        Frontend (Vite; React planned, not yet scaffolded)
packages/game/   Domain logic: word resolution, steal rules, dictionary validation
packages/protocol/  Shared TS types: commands, events, WS message shapes
packages/redis/  Lua scripts + typed Redis client wrapper
infrastructure/  docker-compose.yml for local dev
design-system/   Claude Design export — reference only, not a build dependency
docs/            decisions.md, user-stories.md
```

## Getting started

Requires Node 20+, pnpm, and Docker.

```bash
pnpm install

# start Redis + Postgres locally
docker compose -f infrastructure/docker-compose.yml up redis postgres -d

# run the backend
pnpm dev:server

# run the frontend, in another terminal
pnpm dev:web
```

Backend listens on `:8080`, frontend on `:5173`. The frontend expects
`VITE_WS_URL` (defaults to `ws://localhost:8080`) to reach the backend.

To build and run everything via Docker instead:

```bash
docker compose -f infrastructure/docker-compose.yml up
```

## Contributing / working on this repo

Read `CLAUDE.md` first — it documents the architecture decisions and
conventions (especially the expand/contract rule for anything in
`packages/protocol`, and the client/server split for word-resolution logic)
that any change should follow. `docs/decisions.md` has the fuller reasoning
if you're wondering why something was built a particular way.

## Deployment

Backend + Redis: Railway. Postgres: Neon. Frontend: Vercel. See
`docs/decisions.md` for why.