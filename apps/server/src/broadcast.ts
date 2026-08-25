// Redis pub/sub fan-out: every event that should reach more than the
// sending socket is PUBLISHed on GAME_CHANNEL and re-delivered to whichever
// local sockets this process has in a game's room — see CLAUDE.md "any
// node can handle any game's command", a node that isn't holding the
// socket in question still needs a way to reach it. Shared by
// wsConnection.ts (which owns room membership as sockets connect/
// disconnect) and restRoutes.ts (whose /leave route also needs to publish).

import { WebSocket } from "ws";
import { applyPresence, type Redis } from "@anagrabble/redis";
import type { Event } from "@anagrabble/protocol";
import { stateKey, syncTurnDeadlineTracking, toGameSnapshot } from "./gameSession.js";

const GAME_CHANNEL = "game:events";

export interface Broadcaster {
  publish: (event: Event) => Promise<void>;
  joinRoom: (socket: WebSocket, gameId: string) => void;
  leaveRoom: (socket: WebSocket, gameId: string) => void;
  /** Marks a player's connection as gone the moment its socket closes — see
   * docs/decisions.md "Player presence: connected/disconnected tracking". */
  markDisconnected: (gameId: string, playerId: string) => void;
  /** Closes the subscriber connection this broadcaster created. Does not
   * touch the `redis` client passed to createBroadcaster — that's the
   * caller's to close. */
  close: () => Promise<void>;
}

export async function createBroadcaster(redis: Redis): Promise<Broadcaster> {
  const subscriber = redis.duplicate();
  subscriber.on("error", (err) => console.error("[redis] subscriber error", err));
  await subscriber.connect();

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

  async function publish(event: Event) {
    await redis.publish(GAME_CHANNEL, JSON.stringify(event));
  }

  function markDisconnected(gameId: string, playerId: string) {
    applyPresence(redis, { stateKey: stateKey(gameId), playerId, lastSeenAt: 0 })
      .then((result) => {
        if ("error" in result) return;
        // Only matters for the turn-timer sweep if the player who just went
        // stale is the *current* player — see gameSession.ts's
        // syncTurnDeadlineTracking doc comment. Fire-and-forget: the
        // presence broadcast below has nothing to gain from waiting on
        // this. This is what lets the sweep fast-skip an away current
        // player well before their nominal turnDeadline, same as the
        // frontend's greyed-out presence check.
        if (result.state.turnPlayerId === playerId) {
          syncTurnDeadlineTracking(redis, gameId, result.state);
        }
        return publish({
          type: "GameSnapshot",
          seq: result.state.seq,
          gameId,
          game: toGameSnapshot(gameId, result.state),
        });
      })
      .catch((err) => console.error("[ws] error marking presence stale on close", err));
  }

  return {
    publish,
    joinRoom,
    leaveRoom,
    markDisconnected,
    close: async () => {
      await subscriber.destroy();
    },
  };
}
