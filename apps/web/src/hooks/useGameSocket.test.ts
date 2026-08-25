// Focused on the token-attachment plumbing added for Clerk session
// verification (see apps/server's auth.ts) — the rest of useGameSocket's
// message handling is exercised indirectly through the pages that mock this
// hook entirely (GameBoard/GamePage/NewGamePage). What's genuinely
// non-trivial here, and worth its own test, is the async race: the token
// must resolve before the socket opens, and an unmount mid-resolution must
// not leak a socket.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PING_INTERVAL_MS, RECONNECT_DELAYS_MS } from "../client/gameSocketClient";
import { useGameSocket } from "./useGameSocket";

const getTokenMock = vi.fn();

vi.mock("../auth", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: getTokenMock }),
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  listeners: Record<string, Array<(evt?: unknown) => void>> = {};
  closeCalled = false;
  sent: unknown[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (evt?: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  close() {
    this.closeCalled = true;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  /** Test-only helper: a real socket's "close" listener fires asynchronously
   * whether the close was requested locally or the connection just dropped —
   * callers drive this explicitly rather than have `close()` auto-fire it,
   * so tests can distinguish "close() was called" from "the close event has
   * actually been delivered", same as the real network timing. */
  emitClose() {
    for (const cb of this.listeners.close ?? []) cb();
  }

  emitOpen() {
    for (const cb of this.listeners.open ?? []) cb();
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  getTokenMock.mockReset();
  getTokenMock.mockResolvedValue("tok_abc123");
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useGameSocket", () => {
  it("waits for the Clerk token to resolve, then attaches it to the socket URL", async () => {
    let resolveToken!: (token: string) => void;
    getTokenMock.mockReturnValue(new Promise<string>((resolve) => (resolveToken = resolve)));

    renderHook(() => useGameSocket("game-1"));

    expect(MockWebSocket.instances).toHaveLength(0);

    await act(async () => resolveToken("tok_abc123"));

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const url = new URL(MockWebSocket.instances[0]!.url);
    expect(url.searchParams.get("token")).toBe("tok_abc123");
    expect(url.searchParams.get("game")).toBe("game-1");
  });

  it("omits the token param when signed out", async () => {
    getTokenMock.mockResolvedValue(null);

    renderHook(() => useGameSocket("game-1"));

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const url = new URL(MockWebSocket.instances[0]!.url);
    expect(url.searchParams.has("token")).toBe(false);
  });

  it("does not open a socket if unmounted before the token resolves", async () => {
    let resolveToken!: (token: string | null) => void;
    getTokenMock.mockReturnValue(new Promise<string | null>((resolve) => (resolveToken = resolve)));

    const { unmount } = renderHook(() => useGameSocket("game-1"));
    unmount();

    await act(async () => resolveToken("tok_late"));

    expect(MockWebSocket.instances).toHaveLength(0);
  });
});

// A dropped socket must reopen itself — see docs/user-stories.md
// "Non-functional / cross-cutting" and docs/decisions.md "Realtime
// transport: raw `ws`, not Socket.IO" (the reconnect logic this closes the
// gap on is deliberately hand-written rather than pulled from a framework).
// Fake timers drive the backoff delays; vi.advanceTimersByTimeAsync flushes
// both the timer and the getToken() microtask each retry schedules.
describe("useGameSocket reconnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("reconnects with backoff after the connection drops unexpectedly", async () => {
    const { result } = renderHook(() => useGameSocket("game-1"));
    await flush();
    const socket1 = MockWebSocket.instances[0]!;
    await act(async () => socket1.emitOpen());
    expect(result.current.status).toBe("open");

    await act(async () => socket1.emitClose());
    expect(result.current.status).toBe("reconnecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    await flush(RECONNECT_DELAYS_MS[0]);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(getTokenMock).toHaveBeenCalledTimes(2);
    const socket2 = MockWebSocket.instances[1]!;
    const url = new URL(socket2.url);
    expect(url.searchParams.get("game")).toBe("game-1");

    await act(async () => socket2.emitOpen());
    expect(result.current.status).toBe("open");
  });

  it("does not reconnect after a deliberate close on unmount", async () => {
    const { unmount } = renderHook(() => useGameSocket("game-1"));
    await flush();
    const socket1 = MockWebSocket.instances[0]!;
    await act(async () => socket1.emitOpen());

    unmount();
    expect(socket1.closeCalled).toBe(true);
    await act(async () => socket1.emitClose());

    await flush(RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1] * 10);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("backs off with an increasing delay on repeated drops", async () => {
    const { result } = renderHook(() => useGameSocket("game-1"));
    await flush();
    await act(async () => MockWebSocket.instances[0]!.emitOpen());

    await act(async () => MockWebSocket.instances[0]!.emitClose());
    await flush(RECONNECT_DELAYS_MS[0]);
    expect(MockWebSocket.instances).toHaveLength(2);

    await act(async () => MockWebSocket.instances[1]!.emitClose());
    // The first delay alone isn't enough for the second retry.
    await flush(RECONNECT_DELAYS_MS[0]);
    expect(MockWebSocket.instances).toHaveLength(2);

    await flush(RECONNECT_DELAYS_MS[1] - RECONNECT_DELAYS_MS[0]);
    expect(MockWebSocket.instances).toHaveLength(3);
    expect(result.current.status).toBe("reconnecting");
  });

  it("resets the backoff after a successful reconnect", async () => {
    renderHook(() => useGameSocket("game-1"));
    await flush();
    await act(async () => MockWebSocket.instances[0]!.emitOpen());
    await act(async () => MockWebSocket.instances[0]!.emitClose());
    await flush(RECONNECT_DELAYS_MS[0]);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Reconnect succeeds, then drops again — should use the *first* backoff
    // delay again, not continue escalating from the previous cycle.
    await act(async () => MockWebSocket.instances[1]!.emitOpen());
    await act(async () => MockWebSocket.instances[1]!.emitClose());
    await flush(RECONNECT_DELAYS_MS[0]);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("preserves accumulated game/history state across a reconnect", async () => {
    const { result } = renderHook(() => useGameSocket("game-1"));
    await flush();
    const socket1 = MockWebSocket.instances[0]!;
    await act(async () => socket1.emitOpen());

    const game = {
      gameId: "game-1",
      hostId: "host-1",
      status: "playing",
      seq: 1,
      config: { turnTimerSec: 30, minWordLength: 3, language: "en" },
      turnPlayerId: "host-1",
      turnDeadline: null,
      endGameDeadline: null,
      bankCount: 0,
      pool: [],
      players: [],
    };
    const wordPlayed = {
      type: "WordPlayed",
      seq: 1,
      gameId: "game-1",
      playerId: "host-1",
      word: "CAT",
      usedWords: [],
      usedPoolLetters: ["C", "A", "T"],
      game,
    };
    await act(async () => {
      for (const cb of socket1.listeners.message ?? []) {
        cb({ data: JSON.stringify(wordPlayed) });
      }
    });
    expect(result.current.history).toHaveLength(1);

    await act(async () => socket1.emitClose());
    await flush(RECONNECT_DELAYS_MS[0]);
    await act(async () => MockWebSocket.instances[1]!.emitOpen());

    expect(result.current.history).toHaveLength(1);
    expect(result.current.game).toEqual(game);
  });

  it("appends a playerJoined history entry from a PlayerJoined event", async () => {
    const { result } = renderHook(() => useGameSocket("game-1"));
    await flush();
    const socket1 = MockWebSocket.instances[0]!;
    await act(async () => socket1.emitOpen());

    const game = {
      gameId: "game-1",
      hostId: "host-1",
      status: "playing",
      seq: 2,
      config: { turnTimerSec: 30, minWordLength: 3, language: "en" },
      turnPlayerId: "host-1",
      turnDeadline: null,
      endGameDeadline: null,
      bankCount: 0,
      pool: [],
      players: [{ id: "opp-1", name: "Sam", words: [], score: 0, presence: "connected" }],
    };
    const playerJoined = {
      type: "PlayerJoined",
      seq: 2,
      gameId: "game-1",
      player: { id: "opp-1", name: "Sam", words: [], score: 0 },
      game,
    };

    await act(async () => {
      for (const cb of socket1.listeners.message ?? []) {
        cb({ data: JSON.stringify(playerJoined) });
      }
    });

    expect(result.current.history).toEqual([{ kind: "playerJoined", seq: 2, playerId: "opp-1" }]);
    expect(result.current.game).toEqual(game);
  });

  it("sets tileTurn state for a TileTurned event, and updates game the same as any other snapshot", async () => {
    const { result } = renderHook(() => useGameSocket("game-1"));
    await flush();
    const socket1 = MockWebSocket.instances[0]!;
    await act(async () => socket1.emitOpen());

    expect(result.current.tileTurn).toBeNull();

    const game = {
      gameId: "game-1",
      hostId: "host-1",
      status: "playing",
      seq: 3,
      config: { turnTimerSec: 30, minWordLength: 3, language: "en" },
      turnPlayerId: "host-1",
      turnDeadline: null,
      endGameDeadline: null,
      bankCount: 1,
      pool: ["Q"],
      players: [],
    };
    const tileTurned = { type: "TileTurned", seq: 3, gameId: "game-1", game };

    await act(async () => {
      for (const cb of socket1.listeners.message ?? []) {
        cb({ data: JSON.stringify(tileTurned) });
      }
    });

    expect(result.current.tileTurn).toEqual({ seq: 3 });
    expect(result.current.game).toEqual(game);
  });
});

// The presence heartbeat — see docs/decisions.md "Player presence:
// connected/disconnected tracking". Ping keeps the server's
// lastSeenAt fresh; the Pong reply doubling as a lightweight resync is
// what apps/server's index.ts relies on for other players' presence to
// stay current without a separate broadcast on every heartbeat tick.
describe("useGameSocket heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("sends a Ping immediately on open, then again on the heartbeat interval", async () => {
    renderHook(() => useGameSocket("game-1"));
    await flush();
    const socket = MockWebSocket.instances[0]!;

    await act(async () => socket.emitOpen());
    expect(socket.sent).toEqual([expect.objectContaining({ type: "Ping", gameId: "game-1" })]);

    await flush(PING_INTERVAL_MS);
    expect(socket.sent).toHaveLength(2);
  });

  it("stops pinging once the socket closes", async () => {
    renderHook(() => useGameSocket("game-1"));
    await flush();
    const socket = MockWebSocket.instances[0]!;
    await act(async () => socket.emitOpen());
    expect(socket.sent).toHaveLength(1);

    await act(async () => socket.emitClose());
    await flush(PING_INTERVAL_MS * 3);
    // Only the reconnect's new socket should be pinging now, not this one.
    expect(socket.sent).toHaveLength(1);
  });

  it("adopts the game snapshot carried on a Pong reply", async () => {
    const { result } = renderHook(() => useGameSocket("game-1"));
    await flush();
    const socket = MockWebSocket.instances[0]!;
    await act(async () => socket.emitOpen());

    const game = {
      gameId: "game-1",
      hostId: "host-1",
      status: "lobby",
      seq: 2,
      config: { turnTimerSec: 30, minWordLength: 3, language: "en" },
      turnPlayerId: "host-1",
      turnDeadline: null,
      endGameDeadline: null,
      bankCount: 0,
      pool: [],
      players: [{ id: "host-1", name: "Host", words: [], score: 0, presence: "connected" }],
    };
    const pong = { type: "Pong", seq: 0, gameId: "game-1", game };

    await act(async () => {
      for (const cb of socket.listeners.message ?? []) {
        cb({ data: JSON.stringify(pong) });
      }
    });

    expect(result.current.game).toEqual(game);
  });

  it("ignores a Pong with no snapshot (an unjoined/anonymous connection)", async () => {
    const { result } = renderHook(() => useGameSocket("game-1"));
    await flush();
    const socket = MockWebSocket.instances[0]!;
    await act(async () => socket.emitOpen());

    const pong = { type: "Pong", seq: 0, gameId: "game-1" };
    await act(async () => {
      for (const cb of socket.listeners.message ?? []) {
        cb({ data: JSON.stringify(pong) });
      }
    });

    expect(result.current.game).toBeNull();
  });
});
