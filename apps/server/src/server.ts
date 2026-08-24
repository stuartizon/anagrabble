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
  /** Closes the WS server, the fastify HTTP server, and the internal pub/sub
   * subscriber connection this instance created. Does not touch deps.redis
   * or deps.db — those are the caller's to close. */
  close: () => Promise<void>;
}

export async function createServer(deps: ServerDeps): Promise<AnagrabbleServer> {
  const { redis, db, clerkSecretKey, authMode, webOrigin } = deps;

  const broadcaster = await createBroadcaster(redis);

  const fastify = Fastify({ logger: false });
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
  // after listen().
  const wss = new WebSocketServer({ server: fastify.server });
  wss.on(
    "connection",
    createConnectionHandler({ redis, db, clerkSecretKey, authMode, broadcaster }),
  );

  return {
    fastify,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await fastify.close();
      await broadcaster.close();
    },
  };
}
