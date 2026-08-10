// Local dev only: populates process.env from apps/server/.env. Railway sets
// real environment variables directly in production, where this is a no-op
// (dotenv doesn't throw when the file is missing).
import "dotenv/config";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { createRedisClient } from "@anagrabble/redis";
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
import { verifySessionToken } from "./auth.js";

const PORT = Number(process.env.PORT ?? 8080);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const GAME_CHANNEL = "game:events";

const redis = createRedisClient({ url: REDIS_URL });
const subscriber = redis.duplicate();

redis.on("connect", () => console.log(`[redis] connected to ${REDIS_URL}`));
redis.on("error", (err) => console.error("[redis] connection error", err));
subscriber.on("error", (err) => console.error("[redis] subscriber error", err));

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

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    redis
      .ping()
      .then(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", redis: "ok" }));
      })
      .catch((err) => {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "degraded", redis: "error", error: String(err) }));
      });
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

interface SocketMeta {
  gameId?: string;
  playerId?: string;
  /** Set once the `token` query param (if any) verifies against Clerk.
   * Plumbing only for now — nothing reads this yet, no command is gated on
   * it (see CLAUDE.md "Still open": auth). */
  clerkUserId?: string;
}

wss.on("connection", (socket, req) => {
  console.log("[ws] client connected");
  const meta: SocketMeta = {};

  const handshake: HandshakeMessage = { type: "Handshake", protocolVersion: PROTOCOL_VERSION };
  socket.send(JSON.stringify(handshake));

  const url = new URL(req.url ?? "/", "http://internal");
  const gameId = url.searchParams.get("game");
  const knownPlayerId = url.searchParams.get("player");
  const token = url.searchParams.get("token");
  if (token && CLERK_SECRET_KEY) {
    verifySessionToken(token, CLERK_SECRET_KEY)
      .then((result) => {
        if (result) {
          meta.clerkUserId = result.userId;
          console.log(`[ws] verified Clerk session for user ${result.userId}`);
        } else {
          console.warn("[ws] Clerk session token present but failed to verify");
        }
      })
      .catch((err) => console.error("[ws] error verifying session token", err));
  } else if (token && !CLERK_SECRET_KEY) {
    console.warn(
      "[ws] received a Clerk token but CLERK_SECRET_KEY is not set — skipping verification",
    );
  }
  if (gameId) {
    loadLobbySnapshot(redis, gameId)
      .then((snapshot) => {
        if (!snapshot) {
          sendError(socket, "GameNotFound", `No game with id ${gameId}`, gameId);
          return;
        }
        meta.gameId = gameId;
        joinRoom(socket, gameId);
        // Reconnect (page navigation / reload), not a fresh viewer: only
        // trust `player` if they're actually already seated, so a stranger
        // can't spoof presence via a guessed id.
        if (knownPlayerId && snapshot.players.some((p) => p.id === knownPlayerId)) {
          meta.playerId = knownPlayerId;
          cancelPendingLeave(gameId, knownPlayerId);
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

    try {
      switch (command.type) {
        case "CreateGame": {
          const result = await createGame(redis, command);
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
          meta.playerId = command.hostId;
          joinRoom(socket, command.gameId);
          cancelPendingLeave(command.gameId, command.hostId);
          send(socket, lobbyStateEvent(result.snapshot));
          break;
        }
        case "JoinGame": {
          const result = await joinGame(redis, command);
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
          meta.playerId = command.playerId;
          joinRoom(socket, command.gameId);
          cancelPendingLeave(command.gameId, command.playerId);
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
          const result = await startGame(redis, command);
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
          await publish({
            type: "GameStarted",
            seq: result.snapshot.seq,
            gameId: command.gameId,
            lobby: result.snapshot,
          });
          break;
        }
        case "TurnTile": {
          const result = await turnTile(redis, command);
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
          await publish({
            type: "GameEnded",
            seq: result.snapshot.seq,
            gameId: command.gameId,
            lobby: result.snapshot,
          });
          break;
        }
        case "SubmitWord": {
          const result = await submitWord(redis, command);
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
          await publish({
            type: "WordPlayed",
            seq: result.snapshot.seq,
            gameId: command.gameId,
            playerId: command.playerId,
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

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
