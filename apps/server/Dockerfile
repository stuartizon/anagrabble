# Build context is the repo root (see infrastructure/docker-compose.yml) so pnpm
# can resolve the workspace packages this service depends on.
FROM node:22-alpine

RUN corepack enable

WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/game/package.json packages/game/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/redis/package.json packages/redis/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY packages/game packages/game
COPY packages/protocol packages/protocol
COPY packages/redis packages/redis

WORKDIR /repo/apps/server

EXPOSE 8080

CMD ["pnpm", "dev"]
