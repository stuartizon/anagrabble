// The vendor-facing half of src/observability — the only module in apps/web
// that imports @sentry/react. Everything outside this directory imports from
// ./index, which is a plain barrel; ErrorBoundary.tsx imports from here
// directly to keep the two files acyclic.
//
// The only place in apps/web that knows the error-tracking vendor exists —
// same reasoning as src/auth/ being the only place that imports Clerk:
// swapping Sentry for something else is one file, not every call site. See
// anagrabble#46 and docs/decisions.md "Error tracking: Sentry behind a
// reportError wrapper".
//
// What belongs here is a *bug*: a render that threw, an unhandled rejection,
// a protocol mismatch. A server Error event carrying a domain code
// (NotAWord, NoDecomposition, NotYourTurn, ...) is the game working
// correctly and is rendered as feedback, never reported.

import * as Sentry from "@sentry/react";
import { RELEASE, SENTRY_DSN, SENTRY_ENVIRONMENT } from "../env";

export interface ErrorContext {
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
}

let enabled = false;

/** Called once, from main.tsx. With no DSN — local dev, and every test run
 * — this is a no-op and the whole module degrades to console logging, so
 * nothing here needs a network connection to work. */
export function initObservability(): boolean {
  if (!SENTRY_DSN) return false;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT ?? "development",
    // Set from env.js by CI, so a stack trace can be tied to the deploy it
    // came from. Source maps themselves resolve via the build's debug IDs,
    // not this — see apps/web/vite.config.ts.
    release: RELEASE,
    // Errors only: no tracing, no session replay, no profiling.
    tracesSampleRate: 0,
    // No names, emails, or IP addresses. The Clerk id attached by
    // identifyUser below is an opaque account identifier and the only
    // personal-ish datum that leaves the browser — see the privacy policy
    // (src/pages/PrivacyPage.tsx), which lists it.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  enabled = true;
  return true;
}

/** The WS URL carries the Clerk session token as a query param, so any
 * event or breadcrumb quoting a URL could otherwise ship a live credential
 * to a third party. Redact it everywhere a URL can appear. */
function redactToken(value: string): string {
  return value.replace(/([?&]token=)[^&\s]*/gi, "$1REDACTED");
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.url) event.request.url = redactToken(event.request.url);
  return event;
}

function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  if (typeof breadcrumb.data?.url === "string") {
    breadcrumb.data.url = redactToken(breadcrumb.data.url);
  }
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = redactToken(breadcrumb.message);
  }
  return breadcrumb;
}

/** Attaches the signed-in player's opaque Clerk id to subsequent reports —
 * enough to tell "one player hit this ten times" from "ten players hit it
 * once", with no name or email. Pass null on sign-out. */
export function identifyUser(clerkUserId: string | null): void {
  if (!enabled) return;
  Sentry.setUser(clerkUserId ? { id: clerkUserId } : null);
}

function definedTags(tags: ErrorContext["tags"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function reportError(err: unknown, context?: ErrorContext): void {
  const tags = definedTags(context?.tags);
  console.error(tags.op ? `[${tags.op}]` : "[error]", err, context?.extra ?? "");
  if (!enabled) return;
  Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
    tags,
    extra: context?.extra,
  });
}

export function reportWarning(message: string, context?: ErrorContext): void {
  const tags = definedTags(context?.tags);
  console.warn(tags.op ? `[${tags.op}]` : "[warning]", message, context?.extra ?? "");
  if (!enabled) return;
  Sentry.captureMessage(message, { level: "warning", tags, extra: context?.extra });
}

/** Test-only: module-level state is deliberate (one client per page load),
 * so a suite covering both the disabled and enabled paths must reset it. */
export function resetObservabilityForTests(): void {
  enabled = false;
}
