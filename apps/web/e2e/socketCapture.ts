// Shared by any e2e spec that needs to reach a page's real WebSocket
// instance from outside useGameSocket (force-closing it to simulate an
// unexpected drop, since Chromium's CDP offline emulation doesn't actually
// interrupt an already-open WS — see reconnect.spec.ts for the fuller
// story). Installed via `page.addInitScript` before navigation.
export const captureSocketInit = `
  (() => {
    const NativeWS = window.WebSocket;
    window.__lastSocket = null;
    window.__socketCount = 0;
    window.WebSocket = new Proxy(NativeWS, {
      construct(target, args) {
        const instance = new target(...args);
        instance.__seq = ++window.__socketCount;
        window.__lastSocket = instance;
        return instance;
      },
    });
  })();
`;
