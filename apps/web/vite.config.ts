import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// Source-map upload runs only where it's configured — CI's `build` job, which
// is the one place SENTRY_AUTH_TOKEN exists. A PR build, a local `pnpm build`,
// and a fresh clone all skip it entirely and stay offline (anagrabble#46).
// Reading process.env here is build-tooling config, not app config: nothing
// from it is baked into the bundle, so this doesn't reopen the
// runtime-injected-config decision (docs/decisions.md "Runtime-injected
// frontend config, not build-time VITE_* vars") — the app itself still reads
// its DSN from env.js at runtime.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            authToken: sentryAuthToken,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            sourcemaps: {
              // Uploaded, then deleted before the artifact is packed:
              // Cloudflare Pages serves dist/ verbatim, and unminified
              // source shouldn't be a public URL away.
              filesToDeleteAfterUpload: ["./dist/**/*.map"],
            },
            // No release created here. Frames resolve via the debug IDs the
            // plugin injects into each chunk, which is what lets one
            // unparameterized bundle be built once and deployed to both Dev
            // and Production (CLAUDE.md "Deployment") while still
            // symbolicating in each. The `release` the app reports at runtime
            // comes from env.js instead, for grouping only.
            telemetry: false,
          }),
        ]
      : []),
  ],
  build: {
    // Tied to the upload above rather than always on: Cloudflare Pages
    // serves whatever lands in dist/, so emitting maps on a build that
    // *can't* upload-and-delete them would just publish the app's source.
    // With a token, they're written, uploaded, then removed before the
    // artifact is packed.
    sourcemap: Boolean(sentryAuthToken),
  },
  server: {
    port: 5173,
    // Bind all interfaces, not just localhost — needed so Docker's port
    // publishing (docker-compose.yml's `web` service) can reach the dev
    // server from outside the container. Harmless for a plain host run:
    // localhost access still works, this just also exposes it on the LAN.
    host: true,
  },
});
