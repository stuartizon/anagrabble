// Full WS round-trip tests: a real `ws` client, sending/receiving raw
// protocol JSON, against a real createServer(deps) instance on an ephemeral
// port backed by real (testcontainers) Redis + Postgres — no browser, no
// React, no mocked transport. See CLAUDE.md "Testing strategy" ("full WS
// round-trip tests... once there's more than the lobby/gameplay slices to
// exercise that way") and anagrabble#41 for why this exists alongside the
// unit-level command tests in gameSession.test.ts/game.test.ts and the
// Playwright e2e suite: this is the only layer that exercises the actual `index.ts`
// wiring (Fastify + ws + Redis pub/sub fan-out) rather than the handler
// functions in isolation.

import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createRedisClient, type Redis } from "@anagrabble/redis";
import {
  createDb,
  createPostgresClient,
  runMigrations,
  type Kysely,
  type Database,
  type Pool,
} from "@anagrabble/postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Command, Event, GameSnapshot, HandshakeMessage } from "@anagrabble/protocol";
import { createServer, type AnagrabbleServer } from "./server.js";

const WEB_ORIGIN = "http://localhost:5173";
const CONFIG = { turnTimerSec: 30, minWordLength: 3, language: "en" };

type WireMessage = Event | HandshakeMessage;

/** Wraps a raw `ws` client with a listener attached at construction time —
 * before the caller has even seen `open` — buffering every message it ever
 * receives. Without this, a fast server reply (the `Handshake` sent the
 * instant `wss` gets the `connection` event) can race the test's own
 * `await`-ed continuation after `open` and get dropped before anything is
 * listening for it. `waitForMessage` below first checks the buffer for an
 * already-arrived match before waiting for a new one. */
interface TrackedSocket {
  socket: WebSocket;
  messages: WireMessage[];
  waiters: Array<{ predicate: (msg: WireMessage) => boolean; resolve: (msg: WireMessage) => void }>;
}

function trackSocket(socket: WebSocket): TrackedSocket {
  const tracked: TrackedSocket = { socket, messages: [], waiters: [] };
  socket.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as WireMessage;
    tracked.messages.push(msg);
    const idx = tracked.waiters.findIndex((w) => w.predicate(msg));
    if (idx !== -1) tracked.waiters.splice(idx, 1)[0].resolve(msg);
  });
  return tracked;
}

async function createGameViaRest(baseUrl: string, hostToken: string): Promise<GameSnapshot> {
  const res = await fetch(`${baseUrl}/games`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({ hostName: "Host", config: CONFIG }),
  });
  if (res.status !== 201) {
    throw new Error(`create game failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GameSnapshot;
}

function connect(baseUrl: string, gameId: string, token?: string): Promise<TrackedSocket> {
  const query = token !== undefined ? `?gameId=${gameId}&token=${token}` : `?gameId=${gameId}`;
  const wsUrl = `${baseUrl.replace(/^http/, "ws")}/${query}`;
  const socket = new WebSocket(wsUrl);
  const tracked = trackSocket(socket);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(tracked));
    socket.once("error", reject);
  });
}

function waitForMessage(
  tracked: TrackedSocket,
  predicate: (msg: WireMessage) => boolean,
  timeoutMs = 5000,
): Promise<WireMessage> {
  const already = tracked.messages.find(predicate);
  if (already) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve: (msg: WireMessage) => {
        clearTimeout(timer);
        resolve(msg);
      },
    };
    const timer = setTimeout(() => {
      const idx = tracked.waiters.indexOf(waiter);
      if (idx !== -1) tracked.waiters.splice(idx, 1);
      reject(new Error("timed out waiting for a matching WS message"));
    }, timeoutMs);
    tracked.waiters.push(waiter);
  });
}

function send(tracked: TrackedSocket, command: Command) {
  tracked.socket.send(JSON.stringify(command));
}

describe("server (WS round trip)", () => {
  let redisContainer: StartedRedisContainer;
  let pgContainer: StartedPostgreSqlContainer;
  let redis: Redis;
  let pgPool: Pool;
  let db: Kysely<Database>;
  const servers: AnagrabbleServer[] = [];
  const sockets: TrackedSocket[] = [];

  beforeAll(async () => {
    [redisContainer, pgContainer] = await Promise.all([
      new RedisContainer("redis:7-alpine").start(),
      new PostgreSqlContainer("postgres:16-alpine").start(),
    ]);
    redis = createRedisClient({ url: redisContainer.getConnectionUrl() });
    await redis.connect();
    pgPool = createPostgresClient({ connectionString: pgContainer.getConnectionUri() });
    db = createDb(pgPool);
    await runMigrations(db);
  }, 60_000);

  afterAll(async () => {
    // A just-closed socket's fire-and-forget presence write (server.ts's
    // markDisconnected) can still be in flight against the shared `redis`
    // client at this point — give it a beat so destroying the client here
    // doesn't race it and log a spurious "Disconnects client" error.
    await new Promise((resolve) => setTimeout(resolve, 100));
    redis.destroy();
    await pgPool.end();
    await Promise.all([redisContainer.stop(), pgContainer.stop()]);
  });

  beforeEach(async () => {
    await redis.flushAll();
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.socket.close();
    for (const server of servers.splice(0)) await server.close();
  });

  /** Starts a real createServer(deps) instance on an ephemeral port,
   * sharing the suite's Redis/Postgres, and returns its base HTTP URL. */
  async function startServer(): Promise<string> {
    const server = await createServer({
      redis,
      db,
      clerkSecretKey: "",
      authMode: "mock",
      webOrigin: WEB_ORIGIN,
    });
    servers.push(server);
    const address = await server.fastify.listen({ port: 0, host: "127.0.0.1" });
    return address;
  }

  async function connectAndTrack(baseUrl: string, gameId: string, token: string) {
    const socket = await connect(baseUrl, gameId, token);
    sockets.push(socket);
    return socket;
  }

  it("round-trips JoinGame/StartGame across two connections on one node", async () => {
    const baseUrl = await startServer();

    const game = await createGameViaRest(baseUrl, "host-1");

    const hostSocket = await connectAndTrack(baseUrl, game.gameId, "host-1");
    const handshake = await waitForMessage(hostSocket, (m) => m.type === "Handshake");
    expect((handshake as HandshakeMessage).protocolVersion).toBe(3);
    // Reconnect path: the host is already seated (createGame seats them),
    // so connecting broadcasts a presence-refreshed GameSnapshot rather than
    // sending a direct one.
    await waitForMessage(hostSocket, (m) => m.type === "GameSnapshot");

    const playerSocket = await connectAndTrack(baseUrl, game.gameId, "player-2");
    await waitForMessage(playerSocket, (m) => m.type === "Handshake");
    // Fresh viewer, not yet seated: sent directly, not broadcast.
    await waitForMessage(playerSocket, (m) => m.type === "GameSnapshot");

    const hostSeesJoin = waitForMessage(hostSocket, (m) => m.type === "PlayerJoined");
    send(playerSocket, {
      type: "JoinGame",
      commandId: crypto.randomUUID(),
      gameId: game.gameId,
      playerName: "Player Two",
    });
    const joined = await hostSeesJoin;
    expect(joined.type === "PlayerJoined" && joined.player.name).toBe("Player Two");

    const hostSeesStart = waitForMessage(hostSocket, (m) => m.type === "GameStarted");
    const playerSeesStart = waitForMessage(playerSocket, (m) => m.type === "GameStarted");
    send(hostSocket, { type: "StartGame", commandId: crypto.randomUUID(), gameId: game.gameId });
    const [hostStart, playerStart] = await Promise.all([hostSeesStart, playerSeesStart]);
    expect(hostStart.type === "GameStarted" && hostStart.game.status).toBe("playing");
    expect(playerStart.type === "GameStarted" && playerStart.game.status).toBe("playing");
  });

  it("rejects a command with no verified session", async () => {
    const baseUrl = await startServer();
    const game = await createGameViaRest(baseUrl, "host-1");

    // No token param at all — an anonymous viewer.
    const socket = await connect(baseUrl, game.gameId);
    sockets.push(socket);
    await waitForMessage(socket, (m) => m.type === "Handshake");

    const errorPromise = waitForMessage(socket, (m) => m.type === "Error");
    send(socket, {
      type: "JoinGame",
      commandId: crypto.randomUUID(),
      gameId: game.gameId,
      playerName: "Nobody",
    });
    const error = await errorPromise;
    expect(error.type === "Error" && error.code).toBe("Unauthorized");
  });

  // The scenario nothing else exercises: two server processes, each with
  // their own Redis subscriber connection, must fan a broadcast out to a
  // socket held by whichever node happens to be holding it — see CLAUDE.md
  // "Node servers are stateless... Redis is the single serialization
  // point, not node/actor placement". A command handled entirely by nodeA
  // must still reach a socket connected to nodeB.
  it("fans a broadcast out across two independent server nodes sharing Redis", async () => {
    const [baseUrlA, baseUrlB] = await Promise.all([startServer(), startServer()]);

    const game = await createGameViaRest(baseUrlA, "host-1");

    const hostSocket = await connectAndTrack(baseUrlA, game.gameId, "host-1");
    await waitForMessage(hostSocket, (m) => m.type === "Handshake");
    await waitForMessage(hostSocket, (m) => m.type === "GameSnapshot");

    const playerSocket = await connectAndTrack(baseUrlB, game.gameId, "player-2");
    await waitForMessage(playerSocket, (m) => m.type === "Handshake");
    await waitForMessage(playerSocket, (m) => m.type === "GameSnapshot");

    send(playerSocket, {
      type: "JoinGame",
      commandId: crypto.randomUUID(),
      gameId: game.gameId,
      playerName: "Player Two",
    });
    // nodeB handled the JoinGame command; nodeA's socket only sees it via
    // the shared Redis publish, never a direct in-process call.
    await waitForMessage(hostSocket, (m) => m.type === "PlayerJoined");

    const hostSeesStart = waitForMessage(hostSocket, (m) => m.type === "GameStarted");
    const playerSeesStart = waitForMessage(playerSocket, (m) => m.type === "GameStarted");
    send(hostSocket, { type: "StartGame", commandId: crypto.randomUUID(), gameId: game.gameId });
    const [, playerStart] = await Promise.all([hostSeesStart, playerSeesStart]);
    // nodeA handled StartGame; nodeB's socket must see it fan out too.
    expect(playerStart.type === "GameStarted" && playerStart.game.status).toBe("playing");
  });
});
