// The WS/HTTP gateway itself, factored out of index.ts's module-load
// closure into an exported factory so a test can instantiate one on an
// ephemeral port against a real (testcontainers) Redis/Postgres and drive
// it with a real `ws` client — see CLAUDE.md "Testing strategy" ("full WS
// round-trip tests... once there's more than the lobby/gameplay slices")
// and docs/decisions.md for the fuller rationale. index.ts itself is now
// just env validation + wiring real infra + listen().

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer, WebSocket } from "ws";
import { applyPresence, type Redis } from "@anagrabble/redis";
import {
  insertGame,
  insertWordPlay,
  endGame as recordGameEnded,
  type Kysely,
  type Database,
} from "@anagrabble/postgres";
import {
  PROTOCOL_VERSION,
  type Command,
  type Event,
  type ErrorEvent,
  type HandshakeMessage,
  type LobbySnapshot,
} from "@anagrabble/protocol";
import { joinGame, loadLobbySnapshot, stateKey, toLobbySnapshot } from "./lobby.js";
import { endGame, startGame, submitWord, turnTile } from "./game.js";
import { resolveActingPlayerId, verifyMockSessionToken, verifySessionToken } from "./auth.js";
import { handleStatsRequest } from "./stats.js";
import { handleGetSettingsRequest, handleSaveSettingsRequest } from "./settings.js";
import { handleCreateGameRequest, handleLeaveGameRequest } from "./games.js";

const GAME_CHANNEL = "game:events";

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

  const subscriber = redis.duplicate();
  subscriber.on("error", (err) => console.error("[redis] subscriber error", err));
  await subscriber.connect();

  // Fan-out: every event that should reach more than the sending socket is
  // PUBLISHed here and re-delivered to local sockets by every server
  // process that has one subscribed to that game — see CLAUDE.md "any node
  // can handle any game's command".
  const rooms = new Map<string, Set<WebSocket>>();

  await subscriber.subscribe(GAME_CHANNEL, (message) => {
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

  /** Marks a player's connection as gone the moment its socket closes — see
   * docs/decisions.md "Player presence: connected/disconnected tracking". */
  function markDisconnected(gameId: string, playerId: string) {
    applyPresence(redis, { stateKey: stateKey(gameId), playerId, lastSeenAt: 0 })
      .then((result) => {
        if ("error" in result) return;
        return publish({
          type: "LobbyState",
          seq: result.state.seq,
          gameId,
          lobby: toLobbySnapshot(gameId, result.state),
        });
      })
      .catch((err) => console.error("[ws] error marking presence stale on close", err));
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

  const fastify = Fastify({ logger: false });
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

  fastify.post<{ Params: { gameId: string } }>("/games/:gameId/leave", async (request, reply) => {
    const result = await handleLeaveGameRequest(
      redis,
      clerkSecretKey,
      request.headers.authorization,
      request.params.gameId,
      authMode,
    );
    if (result.status === 200 && result.removed) {
      await publish({
        type: "PlayerLeft",
        seq: result.body.seq,
        gameId: request.params.gameId,
        playerId: result.playerId,
        lobby: result.body,
      });
    }
    return reply.code(result.status).send(result.body);
  });

  // Raw `ws` attaches directly to the underlying node http.Server's native
  // `upgrade` event, bypassing Fastify's own route table entirely.
  // `fastify.server` is available immediately at construction, not just
  // after listen().
  const wss = new WebSocketServer({ server: fastify.server });

  interface SocketMeta {
    gameId?: string;
    playerId?: string;
    /** Set once the `token` query param verifies against Clerk. The
     * authoritative actor identity for every command on this connection —
     * see `resolveActingPlayerId` (auth.ts). A client-claimed id in a
     * command payload is never trusted, not even compared against this. */
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
      ? (authMode === "mock"
          ? Promise.resolve(verifyMockSessionToken(token))
          : verifySessionToken(token, clerkSecretKey)
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
        .then(async (snapshot) => {
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
            const presenceResult = await applyPresence(redis, {
              stateKey: stateKey(gameId),
              playerId: reconnectingPlayerId,
              lastSeenAt: Date.now(),
            });
            if (!("error" in presenceResult)) {
              await publish({
                type: "LobbyState",
                seq: presenceResult.state.seq,
                gameId,
                lobby: toLobbySnapshot(gameId, presenceResult.state),
              });
              return;
            }
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
            // Durable history, async/off-critical-path per
            // docs/postgres-schema.md "Writes are async, after Redis".
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
            // Durable history, async/off-critical-path per
            // docs/postgres-schema.md "Writes are async, after Redis".
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
            // Durable history, async/off-critical-path per
            // docs/postgres-schema.md "Writes are async, after Redis".
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
          case "Ping": {
            // The presence heartbeat — see PingCommand's doc comment
            // (packages/protocol/src/ws.ts).
            if (meta.playerId && meta.gameId) {
              const result = await applyPresence(redis, {
                stateKey: stateKey(meta.gameId),
                playerId: meta.playerId,
                lastSeenAt: Date.now(),
              });
              if (!("error" in result)) {
                send(socket, {
                  type: "Pong",
                  seq: 0,
                  gameId: command.gameId,
                  lobby: toLobbySnapshot(meta.gameId, result.state),
                });
                break;
              }
            }
            send(socket, { type: "Pong", seq: 0, gameId: command.gameId });
            break;
          }
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
      markDisconnected(meta.gameId, meta.playerId);
    });
  });

  return {
    fastify,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await fastify.close();
      await subscriber.destroy();
    },
  };
}
