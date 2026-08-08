import { useCallback, useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION, type Command, type Event, type HandshakeMessage, type LobbySnapshot } from "@anagrabble/protocol";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080";

export type SocketStatus = "connecting" | "open" | "closed";

interface GameSocketState {
  status: SocketStatus;
  lobby: LobbySnapshot | null;
  error: { code: string; message: string } | null;
}

/** Opens (and re-opens, on gameId change) a WebSocket scoped to one lobby
 * page. See CLAUDE.md "Sequencing" — LobbyState/PlayerJoined/PlayerLeft all
 * carry a full snapshot, so the component never has to hand-merge deltas.
 *
 * Pass `knownPlayerId` whenever the caller already knows who it is (Lobby
 * page, Join Game preview) — it's sent as `?player=` so a page-to-page
 * reconnect gets recognized as the same player immediately, rather than
 * the server treating the old socket's close as that player leaving (see
 * apps/server's pendingLeaves debounce). */
export function useGameSocket(gameId?: string, knownPlayerId?: string) {
  const [state, setState] = useState<GameSocketState>({ status: "connecting", lobby: null, error: null });
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setState({ status: "connecting", lobby: null, error: null });
    const params = new URLSearchParams();
    if (gameId) params.set("game", gameId);
    if (gameId && knownPlayerId) params.set("player", knownPlayerId);
    const query = params.toString();
    const url = query ? `${WS_URL}/?${query}` : WS_URL;
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.addEventListener("open", () => setState((s) => ({ ...s, status: "open" })));
    socket.addEventListener("close", () => setState((s) => ({ ...s, status: "closed" })));

    socket.addEventListener("message", (evt) => {
      const message = JSON.parse(evt.data as string) as HandshakeMessage | Event;

      if (message.type === "Handshake") {
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          console.warn(
            `[ws] server protocol version ${message.protocolVersion} differs from client ${PROTOCOL_VERSION}`,
          );
        }
        return;
      }

      if (message.type === "Error") {
        setState((s) => ({ ...s, error: { code: message.code, message: message.message } }));
        return;
      }

      if (message.type === "LobbyState" || message.type === "PlayerJoined" || message.type === "PlayerLeft") {
        setState((s) => ({ ...s, lobby: message.lobby, error: null }));
      }
    });

    return () => socket.close();
  }, [gameId, knownPlayerId]);

  const send = useCallback((command: Command) => {
    socketRef.current?.send(JSON.stringify(command));
  }, []);

  return { ...state, send };
}
