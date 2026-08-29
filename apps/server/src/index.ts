// Local dev only: populates process.env from apps/server/.env. Railway sets
// real environment variables directly in production, where this is a no-op
// (dotenv doesn't throw when the file is missing).
import "dotenv/config";
import { createRedisClient } from "@anagrabble/redis";
import { createDb, createPostgresClient, runMigrations } from "@anagrabble/postgres";
import { createServer } from "./server.js";
import { flushReports, initObservability, reportError } from "./observability.js";

const PORT = Number(process.env.PORT ?? 8080);

// Error reporting is optional infrastructure, unlike the required values
// below: with no DSN the wrapper degrades to plain console logging, which
// is what local dev and every test run get. Initialised before anything
// else here so a failure in the wiring underneath is still reported. See
// anagrabble#46.
initObservability({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? "development",
  // Injected by Railway; absent locally.
  release: process.env.RAILWAY_GIT_COMMIT_SHA,
});

// Nothing caught these before — an unhandled rejection anywhere off the
// await path (a fire-and-forget .catch() someone forgot to add) died
// silently, and an uncaughtException took the process down with no record
// beyond Railway's restart. uncaughtException is genuinely fatal: report,
// flush, then exit non-zero and let railway.json's restartPolicy restart
// us, rather than continuing in an unknown state.
process.on("unhandledRejection", (reason) => {
  reportError(reason, { tags: { op: "process.unhandledRejection" } });
});

process.on("uncaughtException", (err) => {
  reportError(err, { tags: { op: "process.uncaughtException" } });
  void flushReports().then(() => process.exit(1));
});

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error("REDIS_URL is required — see apps/server/.env.example.");
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required — see apps/server/.env.example.");
}

// AUTH_MODE=mock is a local dev/testing-only bypass mirroring apps/web's
// VITE_AUTH_MODE=mock — never set in Railway. See docs/decisions.md "Local
// dev auth: mock provider, not a Clerk sandbox".
const AUTH_MODE = process.env.AUTH_MODE;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
if (AUTH_MODE !== "mock" && !CLERK_SECRET_KEY) {
  throw new Error(
    "CLERK_SECRET_KEY is required unless AUTH_MODE=mock — every command now needs a verified Clerk session (see docs/decisions.md 'Backend Clerk session verification').",
  );
}

// The web app's origin, for CORS on the REST surface (/stats and beyond) —
// see docs/decisions.md "REST endpoints beyond /health". Not needed by the
// WS path (browsers don't apply fetch-style CORS to WebSocket handshakes).
const WEB_ORIGIN = process.env.WEB_ORIGIN;
if (!WEB_ORIGIN) {
  throw new Error("WEB_ORIGIN is required — see apps/server/.env.example.");
}

const redis = createRedisClient({ url: REDIS_URL });

redis.on("connect", () => console.log(`[redis] connected to ${REDIS_URL}`));
// dedupeKey: node-redis retries a broken connection on its own schedule,
// so a Redis outage emits this repeatedly for as long as it lasts — one
// event a minute is enough to know.
redis.on("error", (err) =>
  reportError(err, { tags: { op: "redis.connection" }, dedupeKey: "redis-connection" }),
);

// node-redis, unlike ioredis, doesn't connect on construction.
await redis.connect();

// Postgres is durable history only, never on the critical path of a move
// (CLAUDE.md "Core architecture") — so a migration failure is logged, not
// fatal to startup, unlike CLERK_SECRET_KEY above. runMigrations uses
// Kysely's own Migrator, which locks against concurrent callers (see
// docs/decisions.md "packages/postgres: Kysely for queries and
// migrations"), so multiple server nodes booting at once and racing here is
// safe.
const pgPool = createPostgresClient({ connectionString: DATABASE_URL });
const db = createDb(pgPool);

runMigrations(db)
  .then((applied) => {
    if (applied.length > 0) {
      console.log(`[postgres] applied migrations: ${applied.join(", ")}`);
    } else {
      console.log("[postgres] schema already up to date");
    }
  })
  .catch((err) => reportError(err, { tags: { op: "postgres.migrations" } }));

const { fastify } = await createServer({
  redis,
  db,
  clerkSecretKey: CLERK_SECRET_KEY ?? "",
  authMode: AUTH_MODE,
  webOrigin: WEB_ORIGIN,
});

fastify
  .listen({ port: PORT, host: "0.0.0.0" })
  .then((address) => console.log(`[server] listening on ${address}`))
  .catch(async (err) => {
    reportError(err, { tags: { op: "server.listen" } });
    await flushReports();
    process.exit(1);
  });
