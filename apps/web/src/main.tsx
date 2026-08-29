import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./auth";
import { App } from "./App";
import { ErrorBoundary, initObservability } from "./observability";
import "./styles/global.css";

// Before anything renders, so a throw in the very first render is still
// reported. A no-op unless env.js carries a SENTRY_DSN (anagrabble#46).
initObservability();

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("#app root element not found");

createRoot(rootEl).render(
  <StrictMode>
    {/* Outside AuthProvider: a throw from Clerk's own provider should hit
        the fallback too, not blank the page. */}
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
