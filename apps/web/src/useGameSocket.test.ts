// Focused on the token-attachment plumbing added for Clerk session
// verification (see apps/server's auth.ts) — the rest of useGameSocket's
// message handling is exercised indirectly through the pages that mock this
// hook entirely (GameBoard/LobbyPage/NewGamePage). What's genuinely
// non-trivial here, and worth its own test, is the async race: the token
// must resolve before the socket opens, and an unmount mid-resolution must
// not leak a socket.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameSocket } from "./useGameSocket";

const getTokenMock = vi.fn();

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user_1", getToken: getTokenMock }),
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  listeners: Record<string, Array<() => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  close() {}
  send() {}
}

beforeEach(() => {
  MockWebSocket.instances = [];
  getTokenMock.mockReset();
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
