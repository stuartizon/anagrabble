// Regression coverage for anagrabble ANAGRABBLE-WEB-3: send() used to check
// only that `socket` was non-null, not its readyState — a command fired
// while the socket was still CONNECTING (or a reconnect mid-flight) reached
// a real `WebSocket.send()` and threw InvalidStateError.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameSocketClient } from "./gameSocketClient";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  listeners: Record<string, Array<(evt?: unknown) => void>> = {};
  sent: unknown[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (evt?: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    for (const cb of this.listeners.open ?? []) cb();
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGameSocketClient send", () => {
  it("drops a command sent while the socket is still connecting, instead of throwing", async () => {
    const client = createGameSocketClient({
      getToken: () => Promise.resolve(null),
      onStatusChange: () => {},
      onMessage: () => {},
    });
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0]!;
    expect(socket.readyState).toBe(MockWebSocket.CONNECTING);

    expect(() => client.send({ type: "Ping", commandId: "cmd-1", gameId: "game-1" })).not.toThrow();
    expect(socket.sent).toHaveLength(0);
  });

  it("sends once the socket is open", async () => {
    const client = createGameSocketClient({
      getToken: () => Promise.resolve(null),
      onStatusChange: () => {},
      onMessage: () => {},
    });
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0]!;
    socket.emitOpen();

    client.send({ type: "Ping", commandId: "cmd-1", gameId: "game-1" });

    expect(socket.sent).toEqual([{ type: "Ping", commandId: "cmd-1", gameId: "game-1" }]);
  });
});
