import {
  PROTOCOL_VERSION,
  type Command,
  type Event,
  type HandshakeMessage,
} from "@anagrabble/protocol";
import { WS_URL } from "../env";
import { makeCommandId } from "../utils/commandId";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";

/** Backoff schedule for reconnect attempts after an unexpected close (server
 * restart, network blip) — capped exponential, retried indefinitely rather
 * than giving up, since a stale-but-present tab should keep trying. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

/** How often a connected client sends the presence heartbeat (`Ping`) — see
 * PingCommand's doc comment (packages/protocol/src/ws.ts) and
 * docs/decisions.md "Player presence: connected/disconnected
 * tracking". Kept well under the server's PRESENCE_STALE_MS
 * (apps/server/src/gameSession.ts, currently 10000ms) so a couple of missed beats
 * don't false-positive a still-connected player as stale; the two constants
 * live in separate packages and must be kept roughly in sync by hand. */
export const PING_INTERVAL_MS = 3000;

export interface GameSocketClientOptions {
  gameId?: string;
  /** Resolved fresh on every (re)connect attempt, not just once — a
   * reconnect after a token refresh should carry the current token, not the
   * one from first mount. */
  getToken: () => Promise<string | null>;
  onStatusChange: (status: SocketStatus) => void;
  /** Never sees a `Handshake` message — that's a connection-level protocol-
   * compatibility check (see the `message` listener below), not a game
   * event, and is handled here without ever reaching the caller. */
  onMessage: (event: Event) => void;
}

export interface GameSocketClient {
  send: (command: Command) => void;
  /** Deliberate close — unmount, or the caller (e.g. a gameId change)
   * tearing this connection down. Suppresses the reconnect-with-backoff
   * that an unexpected close would otherwise schedule. */
  close: () => void;
}

/** Owns one WebSocket's full lifecycle — connect (with the Clerk token
 * attached as a query param), reconnect-with-backoff on an unexpected drop,
 * the presence ping heartbeat, and the Handshake protocol-version check —
 * independently of React. useGameSocket wires this to component state via
 * `onStatusChange`/`onMessage`; the mechanics here don't know about
 * `GameSocketState` at all, so they're exercisable (e.g. against a mock
 * WebSocket) with no hook/render involved. */
export function createGameSocketClient(options: GameSocketClientOptions): GameSocketClient {
  const { gameId, getToken, onStatusChange, onMessage } = options;

  let socket: WebSocket | null = null;
  let cancelled = false;
  let intentionalClose = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  async function connect() {
    const token = await getToken().catch(() => null);
    if (cancelled) return;

    const params = new URLSearchParams();
    // Sent under both names during this rollout's expand phase
    // (anagrabble#42): `gameId` is the new name, `game` rides along so an
    // already-deployed old server (still reading only `?game=`) keeps
    // working. Drop `game` in the contract commit once confirmed live —
    // see docs/decisions.md "WS connect query param rename: game -> gameId".
    if (gameId) {
      params.set("gameId", gameId);
      params.set("game", gameId);
    }
    if (token) params.set("token", token);
    const query = params.toString();
    const url = query ? `${WS_URL}/?${query}` : WS_URL;
    const ws = new WebSocket(url);
    socket = ws;

    ws.addEventListener("open", () => {
      reconnectAttempt = 0;
      onStatusChange("open");
      // Fire once immediately (so a reconnect's presence recovers without
      // waiting a full interval) and then on the regular cadence. No-op
      // without a gameId: an anonymous connection has no player to stamp
      // presence for.
      if (gameId) {
        const ping = () => {
          const command: Command = { type: "Ping", commandId: makeCommandId(), gameId };
          ws.send(JSON.stringify(command));
        };
        ping();
        pingTimer = setInterval(ping, PING_INTERVAL_MS);
      }
    });

    // An unexpected close (server restart, network blip) retries with
    // backoff rather than leaving the player stranded. A deliberate close
    // (`close()` below) sets `intentionalClose` first, so this listener
    // knows not to schedule a retry for its own cleanup.
    ws.addEventListener("close", () => {
      if (pingTimer) clearInterval(pingTimer);
      if (cancelled || intentionalClose) {
        onStatusChange("closed");
        return;
      }
      onStatusChange("reconnecting");
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });

    ws.addEventListener("message", (evt) => {
      const message = JSON.parse(evt.data as string) as HandshakeMessage | Event;
      if (message.type === "Handshake") {
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          console.warn(
            `[ws] server protocol version ${message.protocolVersion} differs from client ${PROTOCOL_VERSION}`,
          );
        }
        return;
      }
      onMessage(message);
    });
  }

  connect();

  return {
    send: (command) => {
      socket?.send(JSON.stringify(command));
    },
    close: () => {
      cancelled = true;
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      socket?.close();
    },
  };
}
