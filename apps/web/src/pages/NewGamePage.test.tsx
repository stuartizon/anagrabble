import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SocketStatus } from "../useGameSocket";
import type { LobbySnapshot } from "@anagrabble/protocol";
import { mockSignedInClerk, setMockClerkIdentity } from "../testUtils/clerkTestMock";
import { NewGamePage } from "./NewGamePage";

const send = vi.fn();
const useGameSocketMock = vi.fn();

vi.mock("../useGameSocket", () => ({
  useGameSocket: (...args: unknown[]) => useGameSocketMock(...args),
}));

vi.mock("@clerk/react", () => mockSignedInClerk());

// gameId is client-generated randomly; fix it so the "navigate once the
// server confirms" test can match a specific lobby snapshot to it.
vi.mock("../gameId", () => ({
  makeGameId: () => "FIXED1",
  makeCommandId: () => "cmd-1",
}));

function mockSocket(overrides: {
  status?: SocketStatus;
  lobby?: LobbySnapshot | null;
  error?: { code: string; message: string } | null;
}) {
  useGameSocketMock.mockReturnValue({
    status: overrides.status ?? "open",
    lobby: overrides.lobby ?? null,
    error: overrides.error ?? null,
    send,
  });
}

function AppTree() {
  return (
    <MemoryRouter
      initialEntries={["/"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<NewGamePage />} />
        <Route path="/:gameId" element={<div>Navigated to lobby</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage() {
  return render(<AppTree />);
}

beforeEach(() => {
  send.mockClear();
  useGameSocketMock.mockReset();
  setMockClerkIdentity({ id: "host-1", displayName: "Alex" });
  mockSocket({});
});

describe("NewGamePage", () => {
  it("disables Create game while the socket isn't open", () => {
    mockSocket({ status: "connecting" });
    renderPage();

    expect(screen.getByRole("button", { name: "Create game" })).toBeDisabled();
  });

  it("sends a CreateGame command with the configured rules and the signed-in player's identity", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Create game" }));

    expect(send).toHaveBeenCalledWith({
      type: "CreateGame",
      commandId: "cmd-1",
      gameId: "FIXED1",
      hostId: "host-1",
      hostName: "Alex",
      config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
    });
  });

  it("shows the server error and re-enables the button", () => {
    mockSocket({ error: { code: "GameIdTaken", message: "That game ID is already in use." } });
    renderPage();

    expect(screen.getByText("That game ID is already in use.")).toBeInTheDocument();
  });

  it("navigates to the lobby once the server confirms the game was created", async () => {
    const { rerender } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Create game|Creating/ }));

    mockSocket({
      lobby: {
        gameId: "FIXED1",
        hostId: "host-1",
        status: "lobby",
        seq: 0,
        config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
        turnPlayerIndex: 0,
        turnDeadline: null,
        endGameDeadline: null,
        bankCount: 0,
        pool: [],
        players: [{ id: "host-1", name: "Alex", words: [], score: 0 }],
      },
    });
    rerender(<AppTree />);

    expect(await screen.findByText("Navigated to lobby")).toBeInTheDocument();
  });
});
