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

export const API_URL = requireEnv("API_URL");
export const WS_URL = requireEnv("WS_URL");

// Not a top-level const like the two above: clerkAuth.tsx's module is
// always imported, even in mock-auth mode, where this is legitimately
// unset — so it must only throw once actually read (inside AuthProvider's
// render), not at import time.
export function requireClerkPublishableKey(): string {
  return requireEnv("CLERK_PUBLISHABLE_KEY");
}
