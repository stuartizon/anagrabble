// apps/server's REST surface (/health, /stats, /settings, /games) — see
// docs/decisions.md "Backend HTTP framework" for why Fastify over raw
// node:http. @fastify/cors handles preflight/headers for every route
// registered here. `methods` must be listed explicitly — @fastify/cors's
// own default is 'GET,HEAD,POST' (not every verb, despite first
// appearances), which silently dropped PUT from
// Access-Control-Allow-Methods until PUT /settings (this app's first
// mutating REST endpoint) surfaced it as a real browser CORS failure. POST
// is added deliberately for /games, not rediscovered the same way.

import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import type { Redis } from "@anagrabble/redis";
import type { Kysely, Database } from "@anagrabble/postgres";
import { handleStatsRequest } from "./stats.js";
import { handleGetSettingsRequest, handleSaveSettingsRequest } from "./settings.js";
import { handleCreateGameRequest, handleLeaveGameRequest } from "./games.js";
import type { Broadcaster } from "./broadcast.js";

export interface RestRouteDeps {
  redis: Redis;
  db: Kysely<Database>;
  clerkSecretKey: string;
  authMode?: string;
  webOrigin: string;
  broadcaster: Broadcaster;
}

export async function registerRestRoutes(
  fastify: FastifyInstance,
  deps: RestRouteDeps,
): Promise<void> {
  const { redis, db, clerkSecretKey, authMode, webOrigin, broadcaster } = deps;

  await fastify.register(cors, { origin: webOrigin, methods: ["GET", "HEAD", "PUT", "POST"] });

  fastify.get("/health", async (request, reply) => {
    try {
      await redis.ping();
      return { status: "ok", redis: "ok" };
    } catch (err) {
      return reply.code(503).send({ status: "degraded", redis: "error", error: String(err) });
    }
  });

  fastify.get("/stats", async (request, reply) => {
    const result = await handleStatsRequest(
      db,
      clerkSecretKey,
      request.headers.authorization,
      authMode,
    );
    return reply.code(result.status).send(result.body);
  });

  fastify.get("/settings", async (request, reply) => {
    const result = await handleGetSettingsRequest(
      db,
      clerkSecretKey,
      request.headers.authorization,
      authMode,
    );
    return reply.code(result.status).send(result.body);
  });

  fastify.put("/settings", async (request, reply) => {
    const result = await handleSaveSettingsRequest(
      db,
      clerkSecretKey,
      request.headers.authorization,
      request.body,
      authMode,
    );
    return reply.code(result.status).send(result.body);
  });

  // See docs/decisions.md "CreateGame as a REST endpoint" — moved off the WS
  // command/event pair since, unlike JoinGame/StartGame/etc., there's no
  // other connected client to broadcast a new game's creation to yet.
  fastify.post("/games", async (request, reply) => {
    const result = await handleCreateGameRequest(
      redis,
      clerkSecretKey,
      request.headers.authorization,
      request.body,
      authMode,
    );
    return reply.code(result.status).send(result.body);
  });

  // Explicit, deliberate pre-start leave — see docs/decisions.md "Player
  // presence: connected/disconnected tracking". Unlike CreateGame above,
  // other players are already watching this lobby, so (unlike that route)
  // this one publishes on success.
  fastify.post<{ Params: { gameId: string } }>("/games/:gameId/leave", async (request, reply) => {
    const result = await handleLeaveGameRequest(
      redis,
      clerkSecretKey,
      request.headers.authorization,
      request.params.gameId,
      authMode,
    );
    if (result.status === 200 && result.removed) {
      await broadcaster.publish({
        type: "PlayerLeft",
        seq: result.body.seq,
        gameId: request.params.gameId,
        playerId: result.playerId,
        lobby: result.body,
        game: result.body,
      });
    }
    return reply.code(result.status).send(result.body);
  });
}
