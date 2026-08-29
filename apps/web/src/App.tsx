import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { identifyUser } from "./observability";
import { HomePage } from "./pages/HomePage";
import { RulesPage } from "./pages/RulesPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TermsPage } from "./pages/TermsPage";
import { NewGamePage } from "./pages/NewGamePage";
import { GamePage } from "./pages/GamePage";
import { StatsPage } from "./pages/StatsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LoginPage } from "./pages/LoginPage";
import { SsoCallbackPage } from "./pages/SsoCallbackPage";
import { RequireAuth } from "./components/RequireAuth";

export function App() {
  // Tags reports with the opaque Clerk id — enough to tell one player
  // hitting a bug ten times from ten players hitting it once, with no name
  // or email leaving the browser (see src/observability/sentry.ts).
  const { userId } = useAuth();
  useEffect(() => {
    identifyUser(userId);
  }, [userId]);

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route
          path="/new"
          element={
            <RequireAuth>
              <NewGamePage />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sso-callback" element={<SsoCallbackPage />} />
        <Route
          path="/stats"
          element={
            <RequireAuth>
              <StatsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/:gameId"
          element={
            <RequireAuth>
              <GamePage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
