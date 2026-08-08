import { PROTOCOL_VERSION, type HandshakeMessage } from "@anagrabble/protocol";

// Placeholder skeleton wiring — real UI is fed by the design-system/ export
// once it lands (see CLAUDE.md "Design system"). This just proves the app
// boots and can reach the server over WebSocket.

const appEl = document.querySelector<HTMLDivElement>("#app")!;
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080";

const socket = new WebSocket(WS_URL);

socket.addEventListener("open", () => {
  appEl.textContent = "Anagrabble — connected";
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data) as HandshakeMessage | { type: string };
  if (message.type === "Handshake") {
    const handshake = message as HandshakeMessage;
    if (handshake.protocolVersion !== PROTOCOL_VERSION) {
      console.warn(
        `[ws] server protocol version ${handshake.protocolVersion} differs from client ${PROTOCOL_VERSION}`,
      );
    }
  }
  console.log("[ws] message", message);
});

socket.addEventListener("close", () => {
  appEl.textContent = "Anagrabble — disconnected";
});
