import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import {
  createGameSocketClient,
  PING_INTERVAL_MS,
  RECONNECT_DELAYS_MS,
  type SocketStatus,
} from "../client/gameSocketClient";
import {
  applyGameSocketMessage,
  initialGameSocketState,
  type GameSocketError,
  type GameSocketState,
  type HistoryEntry,
  type PlayerJoinedHistoryEntry,
  type WordPlayNarration,
} from "./gameSocketReducer";
import type { Command } from "@anagrabble/protocol";

export { PING_INTERVAL_MS, RECONNECT_DELAYS_MS };
export type {
  GameSocketError,
  HistoryEntry,
  PlayerJoinedHistoryEntry,
  SocketStatus,
  WordPlayNarration,
};

/** Opens (and re-opens, on gameId change) a WebSocket scoped to one lobby
 * page. See CLAUDE.md "Sequencing" — LobbyState/PlayerJoined/PlayerLeft all
 * carry a full snapshot, so the component never has to hand-merge deltas.
 *
 * A same-page reconnect (a Lobby page reload, or the socket client's own
 * reconnect-with-backoff after an unexpected drop) is recognized as the
 * same player via the verified Clerk session token alone — see
 * apps/server's `resolveActingPlayerId` — so the caller doesn't need to
 * tell this hook who it is.
 *
 * `onTileTurn`, unlike `wordPlay`/`history`, is a callback rather than
 * returned state — TileTurned doesn't need a lobby-derived value (`lobby`
 * already carries the resulting pool), just a one-shot notification, and a
 * callback avoids needing a consumer-side effect to detect "this changed
 * since last render" for something that's really just an event pulse (see
 * anagrabble#36).
 *
 * The WebSocket connect/reconnect/heartbeat mechanics (plus the Handshake
 * protocol-version check) live in `client/gameSocketClient.ts` — pure
 * connection plumbing with no notion of game state. The per-message state
 * transitions, which *are* game logic, live alongside this hook in
 * `./gameSocketReducer.ts`. This hook just wires the two to React state,
 * plus the Clerk-token/callback ref plumbing below. */
export function useGameSocket(gameId?: string, onTileTurn?: () => void) {
  const [state, setState] = useState<GameSocketState>(initialGameSocketState);
  const clientRef = useRef<ReturnType<typeof createGameSocketClient> | null>(null);

  // Read via a ref rather than depending on `getToken` directly in the
  // effect below: Clerk doesn't guarantee its identity is stable across
  // renders, and a reconnect should only happen on a genuine new game/player
  // (gameId/knownPlayerId change), not whenever that identity happens to
  // change.
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  // Same reasoning as getTokenRef above: a fresh inline callback every
  // render must not be a dependency of the connect effect below (that would
  // tear down and reopen the socket on every render of the caller), so it's
  // read via a ref instead.
  const onTileTurnRef = useRef(onTileTurn);
  useEffect(() => {
    onTileTurnRef.current = onTileTurn;
  }, [onTileTurn]);

  useEffect(() => {
    setState(initialGameSocketState());

    const client = createGameSocketClient({
      gameId,
      getToken: () => getTokenRef.current(),
      onStatusChange: (status) => setState((s) => ({ ...s, status })),
      onMessage: (message) => {
        if (message.type === "TileTurned") onTileTurnRef.current?.();
        setState((s) => applyGameSocketMessage(s, message));
      },
    });
    clientRef.current = client;

    return () => {
      client.close();
    };
  }, [gameId]);

  const send = useCallback((command: Command) => {
    clientRef.current?.send(command);
  }, []);

  return { ...state, send };
}
