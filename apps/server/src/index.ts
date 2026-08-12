// Local dev only: populates process.env from apps/server/.env. Railway sets
// real environment variables directly in production, where this is a no-op
// (dotenv doesn't throw when the file is missing).
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer, WebSocket } from "ws";
import { createRedisClient } from "@anagrabble/redis";
import {
  createDb,
  createPostgresClient,
  endGame as recordGameEnded,
  insertGame,
  insertWordPlay,
  runMigrations,
} from "@anagrabble/postgres";
import {
  PROTOCOL_VERSION,
  type Command,
  type Event,
  type ErrorEvent,
  type HandshakeMessage,
  type LobbySnapshot,
} from "@anagrabble/protocol";
import { createGame, joinGame, leaveGame, loadLobbySnapshot } from "./lobby.js";
import { endGame, startGame, submitWord, turnTile } from "./game.js";
import { resolveActingPlayerId, verifyMockSessionToken, verifySessionToken } from "./auth.js";
import { handleStatsRequest } from "./stats.js";
import { handleGetSettingsRequest, handleSaveSettingsRequest } from "./settings.js";

const PORT = Number(process.env.PORT ?? 8080);

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

const GAME_CHANNEL = "game:events";

const redis = createRedisClient({ url: REDIS_URL });
const subscriber = redis.duplicate();

redis.on("connect", () => console.log(`[redis] connected to ${REDIS_URL}`));
redis.on("error", (err) => console.error("[redis] connection error", err));
subscriber.on("error", (err) => console.error("[redis] subscriber error", err));

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
  .catch((err) => console.error("[postgres] failed to run migrations", err));

// Fan-out: every event that should reach more than the sending socket is
// PUBLISHed here and re-delivered to local sockets by every server process
// that has one subscribed to that game. This is what keeps broadcast correct
// under CLAUDE.md's "any node can handle any game's command" — a node that
// isn't holding the socket in question still needs a way to reach it.
const rooms = new Map<string, Set<WebSocket>>();

subscriber.subscribe(GAME_CHANNEL).catch((err) => console.error("[redis] subscribe failed", err));

subscriber.on("message", (_channel, message) => {
  const event = JSON.parse(message) as Event;
  const gameId = "gameId" in event ? event.gameId : undefined;
  if (!gameId) return;
  const sockets = rooms.get(gameId);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
});

function joinRoom(socket: WebSocket, gameId: string) {
  let sockets = rooms.get(gameId);
  if (!sockets) {
    sockets = new Set();
    rooms.set(gameId, sockets);
  }
  sockets.add(socket);
}

function leaveRoom(socket: WebSocket, gameId: string) {
  const sockets = rooms.get(gameId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) rooms.delete(gameId);
}

// A client's WS connection is scoped to one page (see apps/web
// useGameSocket), so a same-player navigation (New Game -> Lobby, or a
// Lobby reload) closes one socket and opens another for the *same* player a
// moment later — that's not the player leaving. Debounce the actual
// Redis/broadcast removal so a prompt reconnect (same gameId+playerId)
// cancels it instead of bouncing the player out of their own lobby.
const LEAVE_GRACE_MS = 3000;
const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>();

function leaveKey(gameId: string, playerId: string) {
  return `${gameId}:${playerId}`;
}

function scheduleLeave(gameId: string, playerId: string) {
  const key = leaveKey(gameId, playerId);
  const timer = setTimeout(async () => {
    pendingLeaves.delete(key);
    try {
      const snapshot = await leaveGame(redis, gameId, playerId);
      if (snapshot) {
        await publish({ type: "PlayerLeft", seq: snapshot.seq, gameId, playerId, lobby: snapshot });
      }
    } catch (err) {
      console.error("[ws] error handling debounced leave", err);
    }
  }, LEAVE_GRACE_MS);
  pendingLeaves.set(key, timer);
}

/** Cancels a pending leave if this playerId reconnects to the same game in
 * time — called both for a passive `?game=&player=` reconnect and for a
 * JoinGame retry from an already-seated player. */
function cancelPendingLeave(gameId: string, playerId: string) {
  const key = leaveKey(gameId, playerId);
  const timer = pendingLeaves.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingLeaves.delete(key);
  }
}

async function publish(event: Event) {
  await redis.publish(GAME_CHANNEL, JSON.stringify(event));
}

function send(socket: WebSocket, event: Event) {
  socket.send(JSON.stringify(event));
}

function sendError(
  socket: WebSocket,
  code: ErrorEvent["code"],
  message: string,
  gameId?: string,
  commandId?: string,
) {
  const event: ErrorEvent = { type: "Error", code, message, gameId, commandId };
  socket.send(JSON.stringify(event));
}

function lobbyStateEvent(snapshot: LobbySnapshot): Event {
  return { type: "LobbyState", seq: snapshot.seq, gameId: snapshot.gameId, lobby: snapshot };
}

// apps/server's REST surface (/health, /stats, /settings) — see
// docs/decisions.md "Backend HTTP framework" for why Fastify over raw
// node:http. @fastify/cors handles preflight/headers for every route
// registered below. `methods` must be listed explicitly — @fastify/cors's
// own default is 'GET,HEAD,POST' (not every verb, despite first
// appearances), which silently dropped PUT from
// Access-Control-Allow-Methods until PUT /settings (this app's first
// mutating REST endpoint) surfaced it as a real browser CORS failure.
const fastify = Fastify({ logger: false });
fastify.register(cors, { origin: WEB_ORIGIN, methods: ["GET", "HEAD", "PUT"] });

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
    CLERK_SECRET_KEY ?? "",
    request.headers.authorization,
    AUTH_MODE,
  );
  return reply.code(result.status).send(result.body);
});

fastify.get("/settings", async (request, reply) => {
  const result = await handleGetSettingsRequest(
    db,
    CLERK_SECRET_KEY ?? "",
    request.headers.authorization,
    AUTH_MODE,
  );
  return reply.code(result.status).send(result.body);
});

fastify.put("/settings", async (request, reply) => {
  const result = await handleSaveSettingsRequest(
    db,
    CLERK_SECRET_KEY ?? "",
    request.headers.authorization,
    request.body,
    AUTH_MODE,
  );
  return reply.code(result.status).send(result.body);
});

// Raw `ws` attaches directly to the underlying node http.Server's native
// `upgrade` event, bypassing Fastify's own route table entirely — same
// mechanism as before, just reached through Fastify. `fastify.server` is
// available immediately at construction, not just after listen().
const wss = new WebSocketServer({ server: fastify.server });

interface SocketMeta {
  gameId?: string;
  playerId?: string;
  /** Set once the `token` query param verifies against Clerk. The
   * authoritative actor identity for every command on this connection —
   * see `resolveActingPlayerId` (auth.ts). A client-claimed id in a command
   * payload is never trusted, not even compared against this. */
  clerkUserId?: string;
}

function rejectUnauthorized(socket: WebSocket, command: Command) {
  sendError(
    socket,
    "Unauthorized",
    "Sign in required to do that",
    command.gameId,
    command.commandId,
  );
}

wss.on("connection", (socket, req) => {
  console.log("[ws] client connected");
  const meta: SocketMeta = {};

  const handshake: HandshakeMessage = { type: "Handshake", protocolVersion: PROTOCOL_VERSION };
  socket.send(JSON.stringify(handshake));

  const url = new URL(req.url ?? "/", "http://internal");
  const gameId = url.searchParams.get("game");
  const token = url.searchParams.get("token");

  // Every command handler awaits this before touching `meta.clerkUserId`,
  // so a message that arrives before verification finishes can't slip
  // through with an unresolved identity — see docs/decisions.md "Backend
  // Clerk session verification".
  const identityReady: Promise<void> = token
    ? (AUTH_MODE === "mock"
        ? Promise.resolve(verifyMockSessionToken(token))
        : // Guaranteed set here: startup throws above unless AUTH_MODE=mock.
          verifySessionToken(token, CLERK_SECRET_KEY as string)
      )
        .then((result) => {
          if (result) {
            meta.clerkUserId = result.userId;
            console.log(`[ws] verified Clerk session for user ${result.userId}`);
          } else {
            console.warn("[ws] Clerk session token present but failed to verify");
          }
        })
        .catch((err) => console.error("[ws] error verifying session token", err))
    : Promise.resolve();

  if (gameId) {
    identityReady
      .then(() => loadLobbySnapshot(redis, gameId))
      .then((snapshot) => {
        if (!snapshot) {
          sendError(socket, "GameNotFound", `No game with id ${gameId}`, gameId);
          return;
        }
        meta.gameId = gameId;
        joinRoom(socket, gameId);
        // Reconnect (page navigation / reload), not a fresh viewer: only
        // seat them back if their verified identity is actually already a
        // player in this game.
        const reconnectingPlayerId = resolveActingPlayerId(meta);
        if (reconnectingPlayerId && snapshot.players.some((p) => p.id === reconnectingPlayerId)) {
          meta.playerId = reconnectingPlayerId;
          cancelPendingLeave(gameId, reconnectingPlayerId);
        }
        send(socket, lobbyStateEvent(snapshot));
      })
      .catch((err) => console.error("[ws] failed to load lobby on connect", err));
  }

  socket.on("message", async (data) => {
    let command: Command;
    try {
      command = JSON.parse(data.toString()) as Command;
    } catch {
      return;
    }

    await identityReady;

    try {
      switch (command.type) {
        case "CreateGame": {
          const hostId = resolveActingPlayerId(meta);
          if (!hostId) {
            rejectUnauthorized(socket, command);
            return;
          }
          const result = await createGame(redis, command, hostId);
          if ("error" in result) {
            sendError(
              socket,
              result.error,
              `Could not create game ${command.gameId}`,
              command.gameId,
              command.commandId,
            );
            return;
          }
          meta.gameId = command.gameId;
          meta.playerId = hostId;
          joinRoom(socket, command.gameId);
          cancelPendingLeave(command.gameId, hostId);
          send(socket, lobbyStateEvent(result.snapshot));
          break;
        }
        case "JoinGame": {
          const playerId = resolveActingPlayerId(meta);
          if (!playerId) {
            rejectUnauthorized(socket, command);
            return;
          }
          const result = await joinGame(redis, command, playerId);
          if ("error" in result) {
            sendError(
              socket,
              result.error,
              `Could not join game ${command.gameId}`,
              command.gameId,
              command.commandId,
            );
            return;
          }
          meta.gameId = command.gameId;
          meta.playerId = playerId;
          joinRoom(socket, command.gameId);
          cancelPendingLeave(command.gameId, playerId);
          if (result.isNew) {
            await publish({
              type: "PlayerJoined",
              seq: result.snapshot.seq,
              gameId: command.gameId,
              player: result.player,
              lobby: result.snapshot,
            });
          } else {
            send(socket, lobbyStateEvent(result.snapshot));
          }
          break;
        }
        case "StartGame": {
          const hostId = resolveActingPlayerId(meta);
          if (!hostId) {
            rejectUnauthorized(socket, command);
            return;
          }
          const result = await startGame(redis, command, hostId);
          if ("error" in result) {
            sendError(
              socket,
              result.error,
              `Could not start game ${command.gameId}`,
              command.gameId,
              command.commandId,
            );
            return;
          }
          // Durable history, async/off-critical-path per docs/postgres-schema.md
          // "Writes are async, after Redis" — never awaited/gated on, a failed
          // write is logged and otherwise accepted-lost (MVP scope, same doc's
          // "Known limitations").
          insertGame(db, {
            id: command.gameId,
            config: result.snapshot.config,
            startedAt: new Date(),
          }).catch((err) => console.error("[postgres] failed to insert game", err));
          await publish({
            type: "GameStarted",
            seq: result.snapshot.seq,
            gameId: command.gameId,
            lobby: result.snapshot,
          });
          break;
        }
        case "TurnTile": {
          const playerId = resolveActingPlayerId(meta);
          if (!playerId) {
            rejectUnauthorized(socket, command);
            return;
          }
          const result = await turnTile(redis, command, playerId);
          if ("error" in result) {
            sendError(
              socket,
              result.error,
              `Could not turn a tile for game ${command.gameId}`,
              command.gameId,
              command.commandId,
            );
            return;
          }
          await publish({
            type: "TileTurned",
            seq: result.snapshot.seq,
            gameId: command.gameId,
            lobby: result.snapshot,
          });
          break;
        }
        case "EndGame": {
          const result = await endGame(redis, command);
          if ("error" in result) {
            sendError(
              socket,
              result.error,
              `Could not end game ${command.gameId}`,
              command.gameId,
              command.commandId,
            );
            return;
          }
          // Durable history, async/off-critical-path per docs/postgres-schema.md
          // "Writes are async, after Redis" — never awaited/gated on, a failed
          // write is logged and otherwise accepted-lost (MVP scope, same doc's
          // "Known limitations").
          recordGameEnded(db, {
            gameId: command.gameId,
            endedAt: new Date(),
            players: result.snapshot.players.map((player, playerIndex) => ({
              clerkUserId: player.id,
              name: player.name,
              playerIndex,
              finalScore: player.score,
              finalWords: player.words,
            })),
          }).catch((err) => console.error("[postgres] failed to record game end", err));
          await publish({
            type: "GameEnded",
            seq: result.snapshot.seq,
            gameId: command.gameId,
            lobby: result.snapshot,
          });
          break;
        }
        case "SubmitWord": {
          const playerId = resolveActingPlayerId(meta);
          if (!playerId) {
            rejectUnauthorized(socket, command);
            return;
          }
          const result = await submitWord(redis, command, playerId);
          if ("error" in result) {
            sendError(
              socket,
              result.error,
              `Could not play "${command.word}" for game ${command.gameId}`,
              command.gameId,
              command.commandId,
            );
            return;
          }
          // Durable history, async/off-critical-path per docs/postgres-schema.md
          // "Writes are async, after Redis" — never awaited/gated on, a failed
          // write is logged and otherwise accepted-lost (MVP scope, same doc's
          // "Known limitations").
          insertWordPlay(db, {
            gameId: command.gameId,
            seq: result.snapshot.seq,
            clerkUserId: playerId,
            word: result.word,
            usedWords: result.usedWords,
            usedPoolLetters: result.usedPoolLetters,
          }).catch((err) => console.error("[postgres] failed to insert word play", err));
          await publish({
            type: "WordPlayed",
            seq: result.snapshot.seq,
            gameId: command.gameId,
            playerId,
            word: result.word,
            usedWords: result.usedWords,
            usedPoolLetters: result.usedPoolLetters,
            lobby: result.snapshot,
          });
          break;
        }
        case "Ping":
          send(socket, { type: "Pong", seq: 0, gameId: command.gameId });
          break;
        default:
          console.log("[ws] unhandled command", (command as { type?: string }).type);
      }
    } catch (err) {
      console.error("[ws] error handling command", command, err);
      sendError(
        socket,
        "InvalidCommand",
        "Server error handling command",
        command.gameId,
        command.commandId,
      );
    }
  });

  socket.on("close", () => {
    console.log("[ws] client disconnected");
    if (!meta.gameId) return;
    leaveRoom(socket, meta.gameId);
    if (!meta.playerId) return;
    scheduleLeave(meta.gameId, meta.playerId);
  });
});

fastify
  .listen({ port: PORT, host: "0.0.0.0" })
  .then((address) => console.log(`[server] listening on ${address}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
