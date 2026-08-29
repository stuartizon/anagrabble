// The WS/HTTP gateway itself, factored out of index.ts's module-load
// closure into an exported factory so a test can instantiate one on an
// ephemeral port against a real (testcontainers) Redis/Postgres and drive
// it with a real `ws` client — see CLAUDE.md "Testing strategy" ("full WS
// round-trip tests... once there's more than the lobby/gameplay slices")
// and docs/decisions.md for the fuller rationale. index.ts itself is now
// just env validation + wiring real infra + listen(). This file is just
// wiring too — the actual fan-out, REST routes, and WS protocol dispatch
// live in broadcast.ts/restRoutes.ts/wsConnection.ts respectively.

import Fastify, { type FastifyInstance } from "fastify";
import { WebSocketServer } from "ws";
import type { Redis } from "@anagrabble/redis";
import type { Kysely, Database } from "@anagrabble/postgres";
import { createBroadcaster } from "./broadcast.js";
import { registerRestRoutes } from "./restRoutes.js";
import { createConnectionHandler } from "./wsConnection.js";
import { startTurnTimerSweep } from "./turnTimerSweep.js";
import { reportError } from "./observability.js";

export interface ServerDeps {
  /** Already connected — createServer duplicates it for the pub/sub
   * subscriber connection but never owns/closes the original. */
  redis: Redis;
  db: Kysely<Database>;
  /** Required unless authMode is "mock" — mirrors index.ts's own startup
   * check, but createServer doesn't repeat that validation itself, since a
   * caller passing an empty string with authMode "mock" (as tests do) is
   * legitimate. */
  clerkSecretKey: string;
  authMode?: string;
  webOrigin: string;
}

export interface AnagrabbleServer {
  fastify: FastifyInstance;
  /** Stops the turn-timer sweep, then closes the WS server, the fastify
   * HTTP server, and the internal pub/sub subscriber connection this
   * instance created. Does not touch deps.redis
   * or deps.db — those are the caller's to close. */
  close: () => Promise<void>;
}

export async function createServer(deps: ServerDeps): Promise<AnagrabbleServer> {
  const { redis, db, clerkSecretKey, authMode, webOrigin } = deps;

  const broadcaster = await createBroadcaster(redis);

  // trustProxy: Railway sits in front of this server as a reverse proxy, so
  // without it request.ip resolves to Railway's proxy rather than the real
  // client — which would make the REST rate limiter (restRoutes.ts) either
  // useless or collapse every caller into one shared bucket.
  const fastify = Fastify({ logger: false, trustProxy: true });

  // Nothing recorded a route throw before this: `logger: false` means
  // Fastify's default handler answers 500 and drops the error on the floor.
  // An onError hook rather than setErrorHandler deliberately — this only
  // observes, so every existing response shape (including
  // @fastify/rate-limit's custom 429 body) is left exactly as it was. Only
  // 5xx is reported: a 4xx is the client being told no, which is the API
  // working. See anagrabble#46.
  fastify.addHook("onError", async (request, _reply, error) => {
    const status = error.statusCode ?? 500;
    if (status < 500) return;
    reportError(error, {
      tags: { op: "http.unhandled", method: request.method, route: request.routeOptions?.url },
    });
  });

  await registerRestRoutes(fastify, {
    redis,
    db,
    clerkSecretKey,
    authMode,
    webOrigin,
    broadcaster,
  });

  // Raw `ws` attaches directly to the underlying node http.Server's native
  // `upgrade` event, bypassing Fastify's own route table entirely.
  // `fastify.server` is available immediately at construction, not just
  // after listen(). `path: "/connect"` rejects an upgrade on any other
  // path (e.g. bare `/`, the pre-anagrabble#50 URL) instead of silently
  // accepting it.
  // maxPayload: a per-message/per-frame cap enforced by `ws` itself (not
  // cumulative across a connection's life) — see anagrabble#45. 16KB is
  // generous headroom over the small JSON command objects this protocol
  // actually sends.
  const wss = new WebSocketServer({
    server: fastify.server,
    path: "/connect",
    maxPayload: 16 * 1024,
  });
  wss.on(
    "connection",
    createConnectionHandler({ redis, db, clerkSecretKey, authMode, broadcaster }),
  );

  const turnTimerSweep = startTurnTimerSweep(redis, broadcaster);

  return {
    fastify,
    close: async () => {
      turnTimerSweep.stop();
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await fastify.close();
      await broadcaster.close();
    },
  };
}
