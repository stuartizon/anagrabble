import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { createGameSocketClient, type SocketStatus } from "../client/gameSocketClient";
import type { Command, Event, GameSnapshot, UsedWord } from "@anagrabble/protocol";

export type { SocketStatus };

/** Narration data for the most recent WordPlayed event — enough for a
 * client to render "Sam stole CAT from You -> CAST" (CLAUDE.md "Core
 * gameplay") without diffing successive `game` snapshots itself. A new
 * object every time (never mutated), so consumers can key a useEffect off
 * its identity to show a one-shot toast. */
export interface WordPlayNarration {
  seq: number;
  playerId: string;
  word: string;
  usedWords: UsedWord[];
}

interface WordPlayHistoryEntry extends WordPlayNarration {
  kind: "wordPlay";
}

/** A player joining the game — narrated from the real `PlayerJoined` event
 * (fires on genuine first join, including mid-game; see apps/server's
 * `joinGame`), not synthesized from a diff. */
export interface PlayerJoinedHistoryEntry {
  kind: "playerJoined";
  seq: number;
  playerId: string;
}

/** One row in the history panel — either a word play or a player joining.
 * Deliberately doesn't cover connect/disconnect/reconnect: those aren't
 * discrete server events (presence writes don't bump `seq` or broadcast on
 * their own — see docs/redis-schema.md "Presence"), so showing them here
 * would mean client-side diffing of `players[].presence` across snapshots —
 * skipped as unnecessary noise for now (see docs/decisions.md "History
 * panel is client-side only"). */
export type HistoryEntry = WordPlayHistoryEntry | PlayerJoinedHistoryEntry;

export interface GameSocketError {
  code: string;
  message: string;
  /** The commandId of whatever was rejected, when the server sent one — lets
   * a consumer correlate this specific rejection back to the specific
   * command that caused it (e.g. which SubmitWord attempt), rather than
   * assuming it's whatever they most recently did. */
  commandId?: string;
}

/** Narration for the most recent TileTurned event — just enough identity
 * (`seq`) for a consumer to key a useEffect off it and fire a one-shot
 * notification (sound/haptics); `game` already carries the resulting pool,
 * so there's nothing else worth carrying here. Mirrors `wordPlay`'s
 * state-not-callback shape rather than being its own separate mechanism. */
export interface TileTurnNarration {
  seq: number;
}

interface GameSocketState {
  status: SocketStatus;
  game: GameSnapshot | null;
  error: GameSocketError | null;
  wordPlay: WordPlayNarration | null;
  tileTurn: TileTurnNarration | null;
  /** Every WordPlayed and PlayerJoined event seen this connection,
   * oldest-first — unlike `wordPlay` (latest-only, for the toast), this
   * accumulates for the history panel. Deliberately resets only on a
   * genuine new connection (fresh page load, or gameId change) — not on
   * every message — so a mid-session reconnect preserves it rather than
   * trashing what's already shown. Purely client-side and ephemeral by
   * design: nothing server-side persists a play log today, so a fresh page
   * load legitimately starts from empty (see docs/decisions.md "History
   * panel is client-side only"). */
  history: HistoryEntry[];
}

function initialGameSocketState(): GameSocketState {
  return {
    status: "connecting",
    game: null,
    error: null,
    wordPlay: null,
    tileTurn: null,
    history: [],
  };
}

/** Pure reducer over one incoming game event — testable with fixture events
 * alone, no real/mock WebSocket needed. Never sees `Handshake` — that's a
 * connection-level concern the socket client handles and swallows itself
 * (see gameSocketClient.ts), not a game event.
 *
 * `message.game ?? message.lobby` throughout: mid-rollout scaffolding (see
 * docs/decisions.md "Lobby -> Game wire rename") — tolerates a server that
 * hasn't redeployed yet and so still only sends the old `lobby` field.
 * Drops once the contract half of that rollout lands and every server
 * always sends `game`. */
function applyGameSocketMessage(state: GameSocketState, message: Event): GameSocketState {
  switch (message.type) {
    // Pong is the heartbeat reply — see PING_INTERVAL_MS and PongEvent's doc
    // comment (packages/protocol/src/ws.ts). The snapshot is only present
    // when this connection is seated as a player; treat it the same as any
    // other snapshot-bearing event below when it is.
    case "Pong": {
      const snapshot = message.game ?? message.lobby;
      return snapshot ? { ...state, game: snapshot } : state;
    }

    case "Error":
      return {
        ...state,
        error: { code: message.code, message: message.message, commandId: message.commandId },
      };

    case "WordPlayed": {
      const narration: WordPlayNarration = {
        seq: message.seq,
        playerId: message.playerId,
        word: message.word,
        usedWords: message.usedWords,
      };
      return {
        ...state,
        game: message.game ?? message.lobby,
        error: null,
        wordPlay: narration,
        history: [...state.history, { kind: "wordPlay", ...narration }],
      };
    }

    case "PlayerJoined": {
      const joined: PlayerJoinedHistoryEntry = {
        kind: "playerJoined",
        seq: message.seq,
        playerId: message.player.id,
      };
      return {
        ...state,
        game: message.game ?? message.lobby,
        error: null,
        history: [...state.history, joined],
      };
    }

    case "TileTurned":
      return {
        ...state,
        game: message.game ?? message.lobby,
        error: null,
        tileTurn: { seq: message.seq },
      };

    case "LobbyState":
    case "PlayerLeft":
    case "GameStarted":
    case "GameEnded":
      return { ...state, game: message.game ?? message.lobby, error: null };

    // Not yet sent by any server (see GameSnapshotEvent's own doc comment)
    // — added ahead of time so this dispatcher already understands it once
    // the contract phase flips LobbyState's wire name over.
    case "GameSnapshot":
      return { ...state, game: message.game, error: null };
  }
}

/** Opens (and re-opens, on gameId change) a WebSocket scoped to one game
 * page. See CLAUDE.md "Sequencing" — LobbyState/PlayerJoined/PlayerLeft all
 * carry a full snapshot, so the component never has to hand-merge deltas.
 *
 * A same-page reconnect (a game page reload, or the socket client's own
 * reconnect-with-backoff after an unexpected drop) is recognized as the
 * same player via the verified Clerk session token alone — see
 * apps/server's `resolveActingPlayerId` — so the caller doesn't need to
 * tell this hook who it is.
 *
 * `tileTurn`, like `wordPlay`, is returned state rather than a callback —
 * both are one-shot event pulses a consumer keys a useEffect off of (by
 * `seq`) to fire a notification (sound/haptics), not values that need
 * ongoing tracking. TileTurned doesn't need a game-derived value of its own
 * (`game` already carries the resulting pool), just that pulse.
 *
 * The WebSocket connect/reconnect/heartbeat mechanics (plus the Handshake
 * protocol-version check) live in `client/gameSocketClient.ts` — pure
 * connection plumbing with no notion of game state, kept separate so it's
 * exercisable (e.g. against a mock WebSocket) with no hook/render involved.
 * Everything else — the per-message state transitions, which *are* game
 * logic — lives right here alongside the hook that owns it. */
export function useGameSocket(gameId?: string) {
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

  useEffect(() => {
    setState(initialGameSocketState());

    const client = createGameSocketClient({
      gameId,
      getToken: () => getTokenRef.current(),
      onStatusChange: (status) => setState((s) => ({ ...s, status })),
      onMessage: (message) => setState((s) => applyGameSocketMessage(s, message)),
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
