import type { Event, LobbySnapshot, UsedWord } from "@anagrabble/protocol";
import type { SocketStatus } from "../client/gameSocketClient";

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

export interface GameSocketState {
  status: SocketStatus;
  lobby: LobbySnapshot | null;
  error: GameSocketError | null;
  wordPlay: WordPlayNarration | null;
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

export function initialGameSocketState(): GameSocketState {
  return { status: "connecting", lobby: null, error: null, wordPlay: null, history: [] };
}

/** Pure reducer over one incoming game event — the message-type dispatch
 * that used to live inline in useGameSocket's `message` listener, pulled out
 * so it's testable with fixture events and no real/mock WebSocket. Never
 * sees `Handshake` — that's a connection-level concern the socket client
 * handles and swallows itself (see gameSocketClient.ts), not a game event. */
export function applyGameSocketMessage(state: GameSocketState, message: Event): GameSocketState {
  switch (message.type) {
    // Pong is the heartbeat reply — see PING_INTERVAL_MS and PongEvent's doc
    // comment (packages/protocol/src/ws.ts). `lobby` is only present when
    // this connection is seated as a player; treat it the same as any other
    // snapshot-bearing event below when it is.
    case "Pong":
      return message.lobby ? { ...state, lobby: message.lobby } : state;

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
        lobby: message.lobby,
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
      return { ...state, lobby: message.lobby, error: null, history: [...state.history, joined] };
    }

    case "TileTurned":
    case "LobbyState":
    case "PlayerLeft":
    case "GameStarted":
    case "GameEnded":
      return { ...state, lobby: message.lobby, error: null };
  }
}
