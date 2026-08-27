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
import type {
  Command,
  Event,
  GameSnapshot,
  GameState,
  HandshakeMessage,
} from "@anagrabble/protocol";
import { createServer, type AnagrabbleServer } from "./server.js";
import { stateKey, TURN_DEADLINES_KEY } from "./gameSession.js";

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
  const wsUrl = `${baseUrl.replace(/^http/, "ws")}/connect${query}`;
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

  // Covers the actual WS wiring behind syncTurnDeadlineTracking's doc
  // comment (gameSession.ts): a presence update only matters to the
  // turn-timer sweep when it's the *current* player's — game.test.ts/
  // turnTimerSweep.test.ts cover the tracking formula and the sweep's own
  // polling in isolation, but only a real Ping/close round trip here
  // exercises the `meta.playerId`/`turnPlayerId` comparisons in
  // wsConnection.ts and broadcast.ts themselves.
  describe("turn-timer sweep tracking follows presence", () => {
    it("updates the tracked due time when the current player pings, not when someone else does", async () => {
      const baseUrl = await startServer();
      const game = await createGameViaRest(baseUrl, "host-1");

      const hostSocket = await connectAndTrack(baseUrl, game.gameId, "host-1");
      await waitForMessage(hostSocket, (m) => m.type === "Handshake");
      await waitForMessage(hostSocket, (m) => m.type === "GameSnapshot");

      const playerSocket = await connectAndTrack(baseUrl, game.gameId, "player-2");
      await waitForMessage(playerSocket, (m) => m.type === "Handshake");
      await waitForMessage(playerSocket, (m) => m.type === "GameSnapshot");
      send(playerSocket, {
        type: "JoinGame",
        commandId: crypto.randomUUID(),
        gameId: game.gameId,
        playerName: "Player Two",
      });
      await waitForMessage(hostSocket, (m) => m.type === "PlayerJoined");

      const hostSeesStart = waitForMessage(hostSocket, (m) => m.type === "GameStarted");
      send(hostSocket, { type: "StartGame", commandId: crypto.randomUUID(), gameId: game.gameId });
      const started = await hostSeesStart;
      // host-1 is the current player: StartGame opens the first turn with
      // the host as turnPlayerId.
      expect(started.type === "GameStarted" && started.game.turnPlayerId).toBe("host-1");

      const before = await redis.zScore(TURN_DEADLINES_KEY, game.gameId);

      const playerSeesPong = waitForMessage(playerSocket, (m) => m.type === "Pong");
      send(playerSocket, { type: "Ping", commandId: crypto.randomUUID(), gameId: game.gameId });
      await playerSeesPong;

      const afterNonCurrentPing = await redis.zScore(TURN_DEADLINES_KEY, game.gameId);
      expect(afterNonCurrentPing).toBe(before);

      // A real clock tick, so a refreshed lastSeenAt is measurably later —
      // otherwise a same-millisecond ZADD could coincidentally match.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const hostSeesPong = waitForMessage(hostSocket, (m) => m.type === "Pong");
      send(hostSocket, { type: "Ping", commandId: crypto.randomUUID(), gameId: game.gameId });
      await hostSeesPong;

      const afterCurrentPing = await redis.zScore(TURN_DEADLINES_KEY, game.gameId);
      expect(afterCurrentPing).toBeGreaterThan(before!);
    });

    it("updates the tracked due time to 'now' when the current player's socket closes, not when someone else's does", async () => {
      const baseUrl = await startServer();
      const game = await createGameViaRest(baseUrl, "host-1");

      const hostSocket = await connectAndTrack(baseUrl, game.gameId, "host-1");
      await waitForMessage(hostSocket, (m) => m.type === "Handshake");
      await waitForMessage(hostSocket, (m) => m.type === "GameSnapshot");

      const playerSocket = await connectAndTrack(baseUrl, game.gameId, "player-2");
      await waitForMessage(playerSocket, (m) => m.type === "Handshake");
      await waitForMessage(playerSocket, (m) => m.type === "GameSnapshot");
      send(playerSocket, {
        type: "JoinGame",
        commandId: crypto.randomUUID(),
        gameId: game.gameId,
        playerName: "Player Two",
      });
      await waitForMessage(hostSocket, (m) => m.type === "PlayerJoined");

      const hostSeesStart = waitForMessage(hostSocket, (m) => m.type === "GameStarted");
      send(hostSocket, { type: "StartGame", commandId: crypto.randomUUID(), gameId: game.gameId });
      const started = await hostSeesStart;
      expect(started.type === "GameStarted" && started.game.turnPlayerId).toBe("host-1");

      const before = await redis.zScore(TURN_DEADLINES_KEY, game.gameId);

      // player-2 (not current) disconnecting shouldn't touch tracking.
      playerSocket.socket.close();
      sockets.splice(sockets.indexOf(playerSocket), 1);
      await new Promise((resolve) => setTimeout(resolve, 100)); // let the fire-and-forget markDisconnected settle
      const afterNonCurrentClose = await redis.zScore(TURN_DEADLINES_KEY, game.gameId);
      expect(afterNonCurrentClose).toBe(before);

      // host-1 (current) disconnecting should pull the due time down to
      // effectively "now" — this is the actual fast-skip fix: the sweep
      // will pick this game up on its very next tick instead of waiting out
      // the rest of turnTimerSec.
      hostSocket.socket.close();
      sockets.splice(sockets.indexOf(hostSocket), 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterCurrentClose = await redis.zScore(TURN_DEADLINES_KEY, game.gameId);
      expect(afterCurrentClose).toBeLessThan(before!);
      expect(afterCurrentClose).toBeLessThanOrEqual(Date.now());
    });
  });

  // Unlike the handler functions above (unit-tested with mocks in
  // games.test.ts/settings.test.ts/stats.test.ts), nothing previously sent a
  // real HTTP request through registerRestRoutes itself — so the route
  // wiring (paths, param binding, status passthrough, and specifically the
  // leave route's own conditional broadcast) had no coverage at any layer.
  describe("REST routes", () => {
    it("GET /health reports ok when redis is reachable", async () => {
      const baseUrl = await startServer();

      const res = await fetch(`${baseUrl}/health`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok", redis: "ok" });
    });

    it("returns 404 from POST /games/:gameId/leave for an unknown game", async () => {
      const baseUrl = await startServer();

      const res = await fetch(`${baseUrl}/games/NOPE1/leave`, {
        method: "POST",
        headers: { authorization: "Bearer host-1" },
      });

      expect(res.status).toBe(404);
    });

    // The one behavior that lives in restRoutes.ts itself, not in
    // games.ts's handleLeaveGameRequest: publishing PlayerLeft on a
    // successful removal. Only provable by actually registering the route
    // and watching another connected client receive the broadcast.
    it("removes a lobby player via POST /games/:gameId/leave and broadcasts PlayerLeft to other connected clients", async () => {
      const baseUrl = await startServer();
      const game = await createGameViaRest(baseUrl, "host-1");

      const hostSocket = await connectAndTrack(baseUrl, game.gameId, "host-1");
      await waitForMessage(hostSocket, (m) => m.type === "Handshake");
      await waitForMessage(hostSocket, (m) => m.type === "GameSnapshot");

      const playerSocket = await connectAndTrack(baseUrl, game.gameId, "player-2");
      await waitForMessage(playerSocket, (m) => m.type === "Handshake");
      await waitForMessage(playerSocket, (m) => m.type === "GameSnapshot");

      const hostSeesJoin = waitForMessage(hostSocket, (m) => m.type === "PlayerJoined");
      send(playerSocket, {
        type: "JoinGame",
        commandId: crypto.randomUUID(),
        gameId: game.gameId,
        playerName: "Player Two",
      });
      await hostSeesJoin;

      const hostSeesLeave = waitForMessage(hostSocket, (m) => m.type === "PlayerLeft");
      const res = await fetch(`${baseUrl}/games/${game.gameId}/leave`, {
        method: "POST",
        headers: { authorization: "Bearer player-2" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as GameSnapshot;
      expect(body.players.map((p) => p.id)).toEqual(["host-1"]);

      const leftEvent = await hostSeesLeave;
      expect(leftEvent.type === "PlayerLeft" && leftEvent.playerId).toBe("player-2");
    });

    it("no-ops (200, removed: false) leaving a game that's already started, without broadcasting", async () => {
      const baseUrl = await startServer();
      const game = await createGameViaRest(baseUrl, "host-1");

      const hostSocket = await connectAndTrack(baseUrl, game.gameId, "host-1");
      await waitForMessage(hostSocket, (m) => m.type === "Handshake");
      await waitForMessage(hostSocket, (m) => m.type === "GameSnapshot");
      send(hostSocket, { type: "StartGame", commandId: crypto.randomUUID(), gameId: game.gameId });
      await waitForMessage(hostSocket, (m) => m.type === "GameStarted");

      const res = await fetch(`${baseUrl}/games/${game.gameId}/leave`, {
        method: "POST",
        headers: { authorization: "Bearer host-1" },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as GameSnapshot;
      expect(body.players.map((p) => p.id)).toEqual(["host-1"]);
    });
  });

  // anagrabble#45: a per-connection in-memory token bucket gates
  // SubmitWord/TurnTile (wsConnection.ts), and @fastify/rate-limit gates
  // POST /games (restRoutes.ts) — see rateLimiter.test.ts for the token
  // bucket's own unit coverage. These two only exercise the actual wiring:
  // that an excess command/request really does come back RateLimited end
  // to end, not just that the underlying primitive works in isolation.
  describe("rate limiting", () => {
    it("rejects gameplay WS commands past the per-connection burst limit with a RateLimited error", async () => {
      const baseUrl = await startServer();
      const game = await createGameViaRest(baseUrl, "host-1");
      const hostSocket = await connectAndTrack(baseUrl, game.gameId, "host-1");
      await waitForMessage(hostSocket, (m) => m.type === "Handshake");
      await waitForMessage(hostSocket, (m) => m.type === "GameSnapshot");

      send(hostSocket, { type: "StartGame", commandId: crypto.randomUUID(), gameId: game.gameId });
      await waitForMessage(hostSocket, (m) => m.type === "GameStarted");

      const rateLimited = waitForMessage(
        hostSocket,
        (m) => m.type === "Error" && m.code === "RateLimited",
      );
      // Burst capacity is 5 — 8 rapid TurnTile commands guarantees at least
      // one gets rejected regardless of whatever the underlying game-logic
      // outcome of the first 5 would otherwise be.
      for (let i = 0; i < 8; i++) {
        send(hostSocket, { type: "TurnTile", commandId: crypto.randomUUID(), gameId: game.gameId });
      }
      await rateLimited;
    });

    it("returns 429 RateLimited from POST /games once the per-IP limit is exceeded", async () => {
      const baseUrl = await startServer();

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          fetch(`${baseUrl}/games`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer host-${i}` },
            body: JSON.stringify({ hostName: `Host ${i}`, config: CONFIG }),
          }),
        ),
      );

      const limited = responses.filter((res) => res.status === 429);
      expect(limited.length).toBeGreaterThan(0);
      const body = (await limited[0].json()) as { error: string };
      expect(body.error).toBe("RateLimited");
    });
  });

  // wsConnection.ts fires these Postgres writes fire-and-forget
  // (.catch(console.error), never awaited/gated on — see CLAUDE.md "Postgres
  // holds durable history"). packages/postgres's own tests cover
  // insertGame/insertWordPlay in isolation given correct args; nothing
  // previously verified that a real accepted WS command actually assembles
  // those args correctly and triggers the write at all.
  describe("durable history writes (Postgres)", () => {
    it("inserts a games row once StartGame is accepted", async () => {
      const baseUrl = await startServer();
      const game = await createGameViaRest(baseUrl, "host-1");
      const hostSocket = await connectAndTrack(baseUrl, game.gameId, "host-1");
      await waitForMessage(hostSocket, (m) => m.type === "Handshake");
      await waitForMessage(hostSocket, (m) => m.type === "GameSnapshot");

      send(hostSocket, { type: "StartGame", commandId: crypto.randomUUID(), gameId: game.gameId });
      await waitForMessage(hostSocket, (m) => m.type === "GameStarted");

      // The write is fire-and-forget from the WS handler's own perspective —
      // poll rather than assume it's landed the instant GameStarted is sent.
      await expect
        .poll(() =>
          db.selectFrom("games").selectAll().where("id", "=", game.gameId).executeTakeFirst(),
        )
        .toMatchObject({ id: game.gameId });
    });

    it("inserts a word_plays row with the resolved play's data once SubmitWord is accepted", async () => {
      const baseUrl = await startServer();
      const game = await createGameViaRest(baseUrl, "host-1");
      const hostSocket = await connectAndTrack(baseUrl, game.gameId, "host-1");
      await waitForMessage(hostSocket, (m) => m.type === "Handshake");
      await waitForMessage(hostSocket, (m) => m.type === "GameSnapshot");

      send(hostSocket, { type: "StartGame", commandId: crypto.randomUUID(), gameId: game.gameId });
      await waitForMessage(hostSocket, (m) => m.type === "GameStarted");

      // Real gameplay draws from a randomly shuffled bag — seed a known
      // pool directly rather than clicking through a nondeterministic
      // number of real TurnTile draws just to get a claimable word.
      const raw = await redis.get(stateKey(game.gameId));
      const state = JSON.parse(raw!) as GameState;
      await redis.set(stateKey(game.gameId), JSON.stringify({ ...state, pool: ["C", "A", "T"] }));

      const commandId = crypto.randomUUID();
      const wordPlayed = waitForMessage(hostSocket, (m) => m.type === "WordPlayed");
      send(hostSocket, { type: "SubmitWord", commandId, gameId: game.gameId, word: "cat" });
      const event = await wordPlayed;
      const seq = event.type === "WordPlayed" ? event.seq : -1;

      await expect
        .poll(() =>
          db
            .selectFrom("word_plays")
            .selectAll()
            .where("game_id", "=", game.gameId)
            .where("seq", "=", seq)
            .executeTakeFirst(),
        )
        .toMatchObject({
          game_id: game.gameId,
          clerk_user_id: "host-1",
          word: "CAT",
          used_pool_letters: expect.arrayContaining(["C", "A", "T"]),
        });
    });
  });
});
