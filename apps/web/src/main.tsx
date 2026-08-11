import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./auth";
import { App } from "./App";
import "./styles/global.css";

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("#app root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
