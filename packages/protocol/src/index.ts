// Shared wire types for the WebSocket protocol between apps/server and apps/web.
// See CLAUDE.md "Protocol conventions" — expand/contract schema evolution rules
// apply to every change in this package.

/** Bumped whenever the wire shape changes; sent in the WS handshake so the
 * server can detect a stale client instead of silently misbehaving. */
export const PROTOCOL_VERSION = 1;

export interface BaseCommand {
  commandId: string;
  gameId: string;
}

export interface BaseEvent {
  seq: number;
  gameId: string;
}

// Placeholder command/event — real game commands (TurnTile, SubmitWord, ...)
// land alongside packages/game implementation.
export interface PingCommand extends BaseCommand {
  type: "Ping";
}

export interface PongEvent extends BaseEvent {
  type: "Pong";
}

export type Command = PingCommand;
export type Event = PongEvent;

export interface HandshakeMessage {
  type: "Handshake";
  protocolVersion: number;
}
