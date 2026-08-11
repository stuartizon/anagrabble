import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind all interfaces, not just localhost — needed so Docker's port
    // publishing (docker-compose.yml's `web` service) can reach the dev
    // server from outside the container. Harmless for a plain host run:
    // localhost access still works, this just also exposes it on the LAN.
    host: true,
  },
});
