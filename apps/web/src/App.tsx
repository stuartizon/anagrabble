import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NewGamePage } from "./pages/NewGamePage";
import { LobbyPage } from "./pages/LobbyPage";
import { LoginPage } from "./pages/LoginPage";
import { SsoCallbackPage } from "./pages/SsoCallbackPage";
import { RequireAuth } from "./components/RequireAuth";

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <NewGamePage />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sso-callback" element={<SsoCallbackPage />} />
        <Route
          path="/:gameId"
          element={
            <RequireAuth>
              <LobbyPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
