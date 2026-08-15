export {};

declare global {
  interface Window {
    // Populated by env.js (see public/env.example.js), loaded via a plain
    // <script> tag in index.html before the app bundle — never baked in at
    // build time, so the same dist/ output is byte-identical across every
    // deploy target. See docs/decisions.md "Runtime-injected frontend
    // config, not build-time VITE_* vars".
    __ENV__?: {
      API_URL?: string;
      WS_URL?: string;
      CLERK_PUBLISHABLE_KEY?: string;
    };
  }
}
