// The WS command-dispatch protocol handler: verifies the connecting
// client's Clerk session, seats a reconnecting player, and switches on each
// Command type to call into gameSession.ts/game.ts, publish the resulting
// Event via the shared Broadcaster, and (for StartGame/EndGame/SubmitWord)
// fire off the async Postgres durable-history write. See docs/decisions.md
// "Backend Clerk session verification" and CLAUDE.md "Command idempotency"/
// "Sequencing".

import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
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
  type GameSnapshot,
} from "@anagrabble/protocol";
import {
  joinGame,
  loadGameSnapshot,
  stateKey,
  syncTurnDeadlineTracking,
  toGameSnapshot,
} from "./gameSession.js";
import { endGame, startGame, submitWord, turnTile } from "./game.js";
import { resolveActingPlayerId, verifyMockSessionToken, verifySessionToken } from "./auth.js";
import { GAMEPLAY_RATE_LIMIT, TokenBucket } from "./rateLimiter.js";
import { reportError } from "./observability.js";
import type { Broadcaster } from "./broadcast.js";

export interface WsConnectionDeps {
  redis: Redis;
  db: Kysely<Database>;
  clerkSecretKey: string;
  authMode?: string;
  broadcaster: Broadcaster;
}

interface SocketMeta {
  gameId?: string;
  playerId?: string;
  /** Set once the `token` query param verifies against Clerk. The
   * authoritative actor identity for every command on this connection —
   * see `resolveActingPlayerId` (auth.ts). A client-claimed id in a
   * command payload is never trusted, not even compared against this. */
  clerkUserId?: string;
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

function gameSnapshotEvent(snapshot: GameSnapshot): Event {
  return { type: "GameSnapshot", seq: snapshot.seq, gameId: snapshot.gameId, game: snapshot };
}

/** Builds the `wss.on("connection", ...)` callback — one closure per server
 * instance, capturing its deps once rather than threading them through
 * every command branch below. */
export function createConnectionHandler(deps: WsConnectionDeps) {
  const { redis, db, clerkSecretKey, authMode, broadcaster } = deps;
  const { publish, joinRoom, leaveRoom, markDisconnected } = broadcaster;

  function rejectUnauthorized(socket: WebSocket, command: Command) {
    sendError(
      socket,
      "Unauthorized",
      "Sign in required to do that",
      command.gameId,
      command.commandId,
    );
  }

  return function handleConnection(socket: WebSocket, req: IncomingMessage) {
    console.log("[ws] client connected");
    const meta: SocketMeta = {};
    // Per-connection, in-memory — see rateLimiter.ts's doc comment for why
    // this doesn't need to be shared/coordinated across Node instances.
    const gameplayRateLimiter = new TokenBucket(GAMEPLAY_RATE_LIMIT);

    const handshake: HandshakeMessage = { type: "Handshake", protocolVersion: PROTOCOL_VERSION };
    socket.send(JSON.stringify(handshake));

    const url = new URL(req.url ?? "/", "http://internal");
    const gameId = url.searchParams.get("gameId");
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
              // Deliberately a plain log, not a report: an expired or
              // revoked session is routine, and the client's own reconnect
              // handles it. Only the catch below is a real fault.
              console.warn("[ws] Clerk session token present but failed to verify");
            }
          })
          // The *throw* only: an expired or forged token resolves to null and
          // is handled above as the routine rejection it is. Reaching here
          // means Clerk itself was unreachable or errored, which nobody can
          // see from the UI (the player just silently can't act).
          .catch((err) => reportError(err, { tags: { op: "ws.verifySession" } }))
      : Promise.resolve();

    if (gameId) {
      identityReady
        .then(() => loadGameSnapshot(redis, gameId))
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
            // Stamp presence as part of the handshake itself rather than
            // waiting on this socket's own next heartbeat Ping — that first
            // "immediate" Ping (useGameSocket.ts) structurally loses a race
            // against meta.playerId being set here, so presence used to lag
            // the real reconnect by up to a full PING_INTERVAL_MS. That
            // staleness was visible to apply_turn_tile.lua too: a reconnected
            // but not-yet-refreshed current player still read as unreachable,
            // so another player's TurnTile could fast-skip them for real. See
            // docs/decisions.md "Presence: reconnect handshake stamps and
            // broadcasts presence directly".
            const presenceResult = await applyPresence(redis, {
              stateKey: stateKey(gameId),
              playerId: reconnectingPlayerId,
              lastSeenAt: Date.now(),
            });
            if (!("error" in presenceResult)) {
              // Only matters for the turn-timer sweep if this reconnect just
              // refreshed the *current* player's presence — see
              // gameSession.ts's syncTurnDeadlineTracking doc comment. Fire-
              // and-forget: the reconnect broadcast below has nothing to
              // gain from waiting on this.
              if (presenceResult.state.turnPlayerId === reconnectingPlayerId) {
                syncTurnDeadlineTracking(redis, gameId, presenceResult.state);
              }
              // Broadcast, not a direct send — this socket already joined
              // the room above, so the publish fans back out to it too (same
              // pattern as JoinGame's PlayerJoined broadcast), and every
              // other connected client sees the presence refresh immediately
              // instead of waiting on their own next heartbeat's Pong.
              const presenceSnapshot = toGameSnapshot(gameId, presenceResult.state);
              await publish({
                type: "GameSnapshot",
                seq: presenceResult.state.seq,
                gameId,
                game: presenceSnapshot,
              });
              return;
            }
          }
          send(socket, gameSnapshotEvent(snapshot));
        })
        .catch((err) => reportError(err, { tags: { op: "ws.connect", gameId } }));
    }

    socket.on("message", async (data) => {
      let command: Command;
      try {
        command = JSON.parse(data.toString()) as Command;
      } catch {
        return;
      }

      await identityReady;

      if (
        (command.type === "SubmitWord" || command.type === "TurnTile") &&
        !gameplayRateLimiter.tryConsume()
      ) {
        sendError(
          socket,
          "RateLimited",
          "Too many commands, slow down",
          command.gameId,
          command.commandId,
        );
        return;
      }

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
                game: result.snapshot,
              });
            } else {
              send(socket, gameSnapshotEvent(result.snapshot));
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
            // docs/postgres-schema.md "Writes are async, after Redis" —
            // never awaited/gated on, a failed write is logged and
            // otherwise accepted-lost (MVP scope, same doc's "Known
            // limitations").
            insertGame(db, {
              id: command.gameId,
              config: result.snapshot.config,
              startedAt: new Date(),
            }).catch((err) =>
              reportError(err, {
                tags: { op: "postgres.insertGame", gameId: command.gameId },
              }),
            );
            await publish({
              type: "GameStarted",
              seq: result.snapshot.seq,
              gameId: command.gameId,
              game: result.snapshot,
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
              game: result.snapshot,
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
            // docs/postgres-schema.md "Writes are async, after Redis" —
            // never awaited/gated on, a failed write is logged and
            // otherwise accepted-lost (MVP scope, same doc's "Known
            // limitations").
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
            }).catch((err) =>
              reportError(err, {
                tags: { op: "postgres.endGame", gameId: command.gameId },
              }),
            );
            await publish({
              type: "GameEnded",
              seq: result.snapshot.seq,
              gameId: command.gameId,
              game: result.snapshot,
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
            // docs/postgres-schema.md "Writes are async, after Redis" —
            // never awaited/gated on, a failed write is logged and
            // otherwise accepted-lost (MVP scope, same doc's "Known
            // limitations").
            insertWordPlay(db, {
              gameId: command.gameId,
              seq: result.snapshot.seq,
              clerkUserId: playerId,
              word: result.word,
              usedWords: result.usedWords,
              usedPoolLetters: result.usedPoolLetters,
            }).catch((err) =>
              reportError(err, {
                tags: { op: "postgres.insertWordPlay", gameId: command.gameId, playerId },
                extra: { word: result.word, seq: result.snapshot.seq },
              }),
            );
            await publish({
              type: "WordPlayed",
              seq: result.snapshot.seq,
              gameId: command.gameId,
              playerId,
              word: result.word,
              usedWords: result.usedWords,
              usedPoolLetters: result.usedPoolLetters,
              game: result.snapshot,
            });
            break;
          }
          case "Ping": {
            // The presence heartbeat — see PingCommand's doc comment
            // (packages/protocol/src/ws.ts). Only a seated player has
            // anything to stamp; an unjoined viewer's Ping is just a no-op
            // keepalive. The reply carries a fresh snapshot so the sender's
            // own view of everyone else's presence stays current too,
            // without a separate server-initiated broadcast on every
            // heartbeat tick.
            if (meta.playerId && meta.gameId) {
              const result = await applyPresence(redis, {
                stateKey: stateKey(meta.gameId),
                playerId: meta.playerId,
                lastSeenAt: Date.now(),
              });
              if (!("error" in result)) {
                // Only matters for the turn-timer sweep if this heartbeat
                // just refreshed the *current* player's presence — see
                // gameSession.ts's syncTurnDeadlineTracking doc comment.
                // Fire-and-forget: the Pong below has nothing to gain from
                // waiting on this.
                if (result.state.turnPlayerId === meta.playerId) {
                  syncTurnDeadlineTracking(redis, meta.gameId, result.state);
                }
                send(socket, {
                  type: "Pong",
                  seq: 0,
                  gameId: command.gameId,
                  game: toGameSnapshot(meta.gameId, result.state),
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
        // Every *expected* rejection above returns early via sendError with a
        // domain code and never lands here. Reaching this catch means
        // something nobody wrote a branch for: a Lua EVAL throwing, a
        // malformed script reply, an unreachable Redis. Always a bug or an
        // infra fault, never ordinary play — see docs/decisions.md "Error
        // tracking: Sentry behind a reportError wrapper".
        reportError(err, {
          tags: {
            op: "ws.command",
            command: command.type,
            gameId: command.gameId,
            commandId: command.commandId,
            playerId: meta.playerId,
          },
        });
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
  };
}
