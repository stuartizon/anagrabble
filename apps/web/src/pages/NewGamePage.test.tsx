import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbySnapshot } from "@anagrabble/protocol";
import { mockSignedInClerk, setMockClerkIdentity } from "../testUtils/clerkTestMock";
import { NewGamePage } from "./NewGamePage";

const createGame = vi.fn();
const { CreateGameError } = vi.hoisted(() => ({
  CreateGameError: class CreateGameError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

vi.mock("../fetchCreateGame", () => ({
  createGame: (...args: unknown[]) => createGame(...args),
  CreateGameError,
}));

vi.mock("../auth", () => mockSignedInClerk());

function sampleSnapshot(overrides: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    gameId: "FIXED1",
    hostId: "host-1",
    status: "lobby",
    seq: 0,
    config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
    turnPlayerId: "host-1",
    turnDeadline: null,
    endGameDeadline: null,
    bankCount: 0,
    pool: [],
    players: [{ id: "host-1", name: "Alex", words: [], score: 0 }],
    ...overrides,
  };
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
  createGame.mockReset();
  setMockClerkIdentity({ id: "host-1", firstName: "Alex" });
});

describe("NewGamePage", () => {
  it("is clickable immediately, with no socket handshake to wait for", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Create game" })).toBeEnabled();
  });

  it("posts to /games with the configured rules and the signed-in player's identity", async () => {
    createGame.mockReturnValue(new Promise(() => {})); // never resolves — just inspect the call
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Create game" }));

    expect(createGame).toHaveBeenCalledWith("test-token", {
      hostName: "Alex",
      config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
    });
  });

  it("disables the button and shows 'Creating…' while the request is in flight", async () => {
    createGame.mockReturnValue(new Promise(() => {}));
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Create game" }));

    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });

  it("opens the rules modal from the Review the rules link", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Review the rules" }));

    expect(screen.getByRole("dialog", { name: "Rules" })).toBeInTheDocument();
  });

  it("navigates to the lobby once the server confirms the game was created", async () => {
    createGame.mockResolvedValue(sampleSnapshot());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Create game" }));

    expect(await screen.findByText("Navigated to lobby")).toBeInTheDocument();
  });

  it("shows a generic message and re-enables the button on any failure", async () => {
    createGame.mockRejectedValue(new Error("network down"));
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Create game" }));

    expect(
      await screen.findByText("Something went wrong creating your game. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create game" })).toBeEnabled();
  });
});
