import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import {
  PROTOCOL_VERSION,
  type Command,
  type Event,
  type HandshakeMessage,
  type LobbySnapshot,
  type UsedWord,
} from "@anagrabble/protocol";

const WS_URL = import.meta.env.VITE_WS_URL;
if (!WS_URL) throw new Error("VITE_WS_URL is not set");

export type SocketStatus = "connecting" | "open" | "closed";

/** Narration data for the most recent WordPlayed event — enough for a
 * client to render "Sam stole CAT from You -> CAST" (CLAUDE.md "Core
 * gameplay") without diffing successive `lobby` snapshots itself. A new
 * object every time (never mutated), so consumers can key a useEffect off
 * its identity to show a one-shot toast. */
export interface WordPlayNarration {
  seq: number;
  playerId: string;
  word: string;
  usedWords: UsedWord[];
}

export interface GameSocketError {
  code: string;
  message: string;
  /** The commandId of whatever was rejected, when the server sent one — lets
   * a consumer correlate this specific rejection back to the specific
   * command that caused it (e.g. which SubmitWord attempt), rather than
   * assuming it's whatever they most recently did. */
  commandId?: string;
}

interface GameSocketState {
  status: SocketStatus;
  lobby: LobbySnapshot | null;
  error: GameSocketError | null;
  wordPlay: WordPlayNarration | null;
  /** Every WordPlayed event seen this connection, oldest-first — unlike
   * `wordPlay` (latest-only, for the toast), this accumulates for the
   * history panel. Deliberately resets only when the effect below re-runs
   * (a genuine new connection: fresh page load, or gameId change) — not on
   * every message — so a mid-session reconnect (once that exists) can
   * preserve it rather than trashing what's already shown. Purely
   * client-side and ephemeral by design: nothing server-side persists a
   * play log today, so a fresh page load legitimately starts from empty
   * (see docs/decisions.md "History panel is client-side only"). */
  history: WordPlayNarration[];
}

/** Opens (and re-opens, on gameId change) a WebSocket scoped to one lobby
 * page. See CLAUDE.md "Sequencing" — LobbyState/PlayerJoined/PlayerLeft all
 * carry a full snapshot, so the component never has to hand-merge deltas.
 *
 * A page-to-page reconnect (Lobby page reload, New Game -> Lobby) is
 * recognized as the same player via the verified Clerk session token alone
 * — see apps/server's `resolveActingPlayerId` and `pendingLeaves` debounce —
 * so the caller doesn't need to tell this hook who it is. */
export function useGameSocket(gameId?: string) {
  const [state, setState] = useState<GameSocketState>({
    status: "connecting",
    lobby: null,
    error: null,
    wordPlay: null,
    history: [],
  });
  const socketRef = useRef<WebSocket | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    setState({ status: "connecting", lobby: null, error: null, wordPlay: null, history: [] });

    async function connect() {
      const token = await getTokenRef.current().catch(() => null);
      if (cancelled) return;

      const params = new URLSearchParams();
      if (gameId) params.set("game", gameId);
      if (token) params.set("token", token);
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
          setState((s) => ({
            ...s,
            error: { code: message.code, message: message.message, commandId: message.commandId },
          }));
          return;
        }

        if (message.type === "WordPlayed") {
          const narration: WordPlayNarration = {
            seq: message.seq,
            playerId: message.playerId,
            word: message.word,
            usedWords: message.usedWords,
          };
          setState((s) => ({
            ...s,
            lobby: message.lobby,
            error: null,
            wordPlay: narration,
            history: [...s.history, narration],
          }));
          return;
        }

        if (
          message.type === "LobbyState" ||
          message.type === "PlayerJoined" ||
          message.type === "PlayerLeft" ||
          message.type === "GameStarted" ||
          message.type === "TileTurned" ||
          message.type === "GameEnded"
        ) {
          setState((s) => ({ ...s, lobby: message.lobby, error: null }));
        }
      });
    }

    connect();

    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, [gameId]);

  const send = useCallback((command: Command) => {
    socketRef.current?.send(JSON.stringify(command));
  }, []);

  return { ...state, send };
}
