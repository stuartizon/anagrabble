import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbySnapshot, PlayerState } from "@anagrabble/protocol";
import type { SocketStatus } from "../useGameSocket";
import { LobbyPage } from "./LobbyPage";

const send = vi.fn();
const useGameSocketMock = vi.fn();

vi.mock("../useGameSocket", () => ({
  useGameSocket: (...args: unknown[]) => useGameSocketMock(...args),
}));

vi.mock("../gameId", () => ({
  makeCommandId: () => "cmd-1",
}));

const HOST: PlayerState = {
  id: "host-1",
  name: "Host",
  words: [],
  score: 0,
  color: "var(--player-1)",
};
const GUEST: PlayerState = {
  id: "guest-1",
  name: "Guest",
  words: [],
  score: 0,
  color: "var(--player-2)",
};

function lobbySnapshot(overrides: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    gameId: "ABCDE",
    hostId: "host-1",
    status: "lobby",
    seq: 0,
    config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
    turnPlayerIndex: 0,
    turnDeadline: null,
    endGameDeadline: null,
    bankCount: 0,
    pool: [],
    players: [HOST],
    ...overrides,
  };
}

function mockSocket(overrides: {
  status?: SocketStatus;
  lobby?: LobbySnapshot | null;
  error?: { code: string; message: string } | null;
}) {
  useGameSocketMock.mockReturnValue({
    status: overrides.status ?? "open",
    lobby: overrides.lobby === undefined ? lobbySnapshot() : overrides.lobby,
    error: overrides.error ?? null,
    send,
  });
}

function renderAsPlayer(playerId: string) {
  // getPlayerIdentity() regenerates a fresh (random-id) identity whenever
  // the stored name is falsy, so the seeded name must be non-empty for the
  // seeded id to stick.
  localStorage.setItem(
    "anagrabble_player",
    JSON.stringify({ id: playerId, name: playerId === "guest-1" ? "Guest" : "Host" }),
  );
  return render(
    <MemoryRouter
      initialEntries={["/ABCDE"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/:gameId" element={<LobbyPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  send.mockClear();
  useGameSocketMock.mockReset();
  localStorage.clear();
  mockSocket({});
});

describe("LobbyPage", () => {
  it("shows only the header while the lobby hasn't loaded yet", () => {
    mockSocket({ lobby: null });
    renderAsPlayer("host-1");

    expect(screen.queryByText(/game/i)).not.toBeInTheDocument();
  });

  it("shows a not-found message and returns home on error", async () => {
    mockSocket({ error: { code: "GameNotFound", message: "not found" } });
    renderAsPlayer("host-1");

    expect(screen.getByText("Game not found")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back home" }));

    expect(await screen.findByText("Home")).toBeInTheDocument();
  });

  describe("as the host", () => {
    it("shows the player list and disables Start with fewer than two players", () => {
      mockSocket({ lobby: lobbySnapshot({ players: [HOST] }) });
      renderAsPlayer("host-1");

      expect(screen.getByText("1 player at the table")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Waiting for players…" })).toBeDisabled();
    });

    it("enables Start once a second player has joined", () => {
      mockSocket({ lobby: lobbySnapshot({ players: [HOST, GUEST] }) });
      renderAsPlayer("host-1");

      expect(screen.getByText("2 players at the table")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();
    });

    it("sends StartGame when Start is clicked", async () => {
      mockSocket({ lobby: lobbySnapshot({ players: [HOST, GUEST] }) });
      renderAsPlayer("host-1");

      await userEvent.click(screen.getByRole("button", { name: "Start game" }));

      expect(send).toHaveBeenCalledWith({
        type: "StartGame",
        commandId: "cmd-1",
        gameId: "ABCDE",
        hostId: "host-1",
      });
    });
  });

  describe("once the game has started", () => {
    it("renders the game board instead of the lobby card", () => {
      mockSocket({
        lobby: lobbySnapshot({
          status: "playing",
          players: [HOST, GUEST],
          bankCount: 143,
          pool: ["A"],
          turnPlayerIndex: 0,
          turnDeadline: Date.now() + 30_000,
        }),
      });
      renderAsPlayer("host-1");

      expect(screen.getByText("143 tiles left")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Start game/ })).not.toBeInTheDocument();
    });
  });

  describe("as an unjoined guest", () => {
    it("disables Join until a name is entered, then sends JoinGame", async () => {
      mockSocket({ lobby: lobbySnapshot({ players: [HOST] }) });
      renderAsPlayer("guest-1");

      const nameInput = screen.getByLabelText("Your name");
      const joinButton = screen.getByRole("button", { name: "Join game" });

      await userEvent.clear(nameInput);
      expect(joinButton).toBeDisabled();

      await userEvent.type(nameInput, "Guest");
      expect(joinButton).toBeEnabled();

      await userEvent.click(joinButton);

      expect(send).toHaveBeenCalledWith({
        type: "JoinGame",
        commandId: "cmd-1",
        gameId: "ABCDE",
        playerId: "guest-1",
        playerName: "Guest",
      });
    });
  });

  describe("as a joined non-host player", () => {
    it("shows a waiting message and no Join/Start controls", () => {
      mockSocket({ lobby: lobbySnapshot({ players: [HOST, GUEST] }) });
      renderAsPlayer("guest-1");

      expect(screen.getByText("Waiting for the host to start the game…")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Join game" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Start game|Waiting for players/ }),
      ).not.toBeInTheDocument();
    });
  });
});
