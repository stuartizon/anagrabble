# The production build — this is what Railway deploys (railway.json points
# "dockerfilePath" directly at this file). Build context is the repo root
# (set by railway.json / whoever invokes `docker build`) so pnpm can
# resolve the workspace packages this service depends on. Not used by
# local dev's infrastructure/docker-compose.yml, which uses
# infrastructure/dev.Dockerfile plus a bind-mounted checkout instead, so
# `tsx watch` sees host edits without needing a rebuild — this file's
# COPY-based snapshot build is the wrong shape for that.
FROM node:22-alpine

RUN corepack enable

WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/game/package.json packages/game/package.json
COPY packages/postgres/package.json packages/postgres/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/redis/package.json packages/redis/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY packages/game packages/game
COPY packages/postgres packages/postgres
COPY packages/protocol packages/protocol
COPY packages/redis packages/redis

WORKDIR /repo/apps/server

EXPOSE 8080

CMD ["pnpm", "dev"]
