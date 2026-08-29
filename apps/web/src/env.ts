// Runtime config, not build-time: window.__ENV__ is set by env.js (see
// public/env.example.js), loaded via a <script> tag in index.html before
// this module ever runs.
type EnvKey = keyof NonNullable<Window["__ENV__"]>;

function requireEnv(key: EnvKey): string {
  const value = window.__ENV__?.[key];
  if (!value)
    throw new Error(`${key} is not set (window.__ENV__ missing or incomplete — check env.js)`);
  return value;
}

/** For values the app is expected to run without — unlike the two below,
 * an unset one is a normal configuration, not a broken deploy. */
function optionalEnv(key: EnvKey): string | undefined {
  return window.__ENV__?.[key] || undefined;
}

export const API_URL = requireEnv("API_URL");
export const WS_URL = requireEnv("WS_URL");

// Error reporting — absent locally and in tests, set by CI per environment
// (see .github/workflows/ci.yml's "Write runtime env" step).
export const SENTRY_DSN = optionalEnv("SENTRY_DSN");
export const SENTRY_ENVIRONMENT = optionalEnv("SENTRY_ENVIRONMENT");
export const RELEASE = optionalEnv("RELEASE");

// Not a top-level const like the two above: clerkAuth.tsx's module is
// always imported, even in mock-auth mode, where this is legitimately
// unset — so it must only throw once actually read (inside AuthProvider's
// render), not at import time.
export function requireClerkPublishableKey(): string {
  return requireEnv("CLERK_PUBLISHABLE_KEY");
}
