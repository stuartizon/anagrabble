// Barrel: everything outside this directory imports from here, never from
// ./sentry (the only module that touches the vendor SDK) — see that file's
// doc comment and docs/decisions.md "Error tracking: Sentry behind a
// reportError wrapper".

export {
  initObservability,
  identifyUser,
  reportError,
  reportWarning,
  resetObservabilityForTests,
  type ErrorContext,
} from "./sentry";
export { ErrorBoundary } from "./ErrorBoundary";
