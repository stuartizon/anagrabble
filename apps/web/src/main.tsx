import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { App } from "./App";
import "./styles/global.css";

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("#app root element not found");

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!CLERK_PUBLISHABLE_KEY) throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set");

createRoot(rootEl).render(
  <StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <App />
    </ClerkProvider>
  </StrictMode>,
);
