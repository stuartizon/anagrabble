# Local dev only, used by docker-compose.yml's `server` and `seed-mock-stats`
# services. Deliberately NOT apps/server/Dockerfile — that one COPYs a
# frozen snapshot of the source at build time (correct for a production
# image, and what Railway actually deploys per railway.json) and only
# reflects host edits after a rebuild. This image has no source at all
# baked in; docker-compose.yml bind-mounts the repo root into it at
# /repo, so `tsx watch` sees host edits live, no rebuild needed. Only
# rebuild this image when the toolchain itself changes (Node/pnpm version),
# not for ordinary code changes.
FROM node:22-alpine

RUN corepack enable

WORKDIR /repo
