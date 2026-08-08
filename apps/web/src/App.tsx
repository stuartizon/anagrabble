import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NewGamePage } from "./pages/NewGamePage";
import { LobbyPage } from "./pages/LobbyPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NewGamePage />} />
        <Route path="/:gameId" element={<LobbyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
