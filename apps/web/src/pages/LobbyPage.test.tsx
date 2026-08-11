import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbySnapshot, PlayerState } from "@anagrabble/protocol";
import type { SocketStatus } from "../useGameSocket";
import { mockSignedInClerk, setMockClerkIdentity } from "../testUtils/clerkTestMock";
import { LobbyPage } from "./LobbyPage";

const send = vi.fn();
const useGameSocketMock = vi.fn();

vi.mock("../useGameSocket", () => ({
  useGameSocket: (...args: unknown[]) => useGameSocketMock(...args),
}));

vi.mock("../auth", () => mockSignedInClerk());

vi.mock("../gameId", () => ({
  makeCommandId: () => "cmd-1",
}));

const HOST: PlayerState = {
  id: "host-1",
  name: "Host",
  words: [],
  score: 0,
};
const GUEST: PlayerState = {
  id: "guest-1",
  name: "Guest",
  words: [],
  score: 0,
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
    wordPlay: null,
    history: [],
    send,
  });
}

function renderAsPlayer(playerId: string) {
  setMockClerkIdentity({ id: playerId, firstName: playerId === "guest-1" ? "Guest" : "Host" });
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

  it("does not swap to the not-found page for a non-fatal error (e.g. a rejected word)", () => {
    mockSocket({
      lobby: lobbySnapshot({ players: [HOST, GUEST] }),
      error: { code: "NotAWord", message: "Not a word we know" },
    });
    renderAsPlayer("guest-1");

    expect(screen.queryByText("Game not found")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for the host to start the game…")).toBeInTheDocument();
  });

  it("opens the rules modal from the Review the rules link", async () => {
    mockSocket({ lobby: lobbySnapshot({ players: [HOST] }) });
    renderAsPlayer("host-1");

    await userEvent.click(screen.getByRole("button", { name: "Review the rules" }));

    expect(screen.getByRole("dialog", { name: "Rules" })).toBeInTheDocument();
  });

  describe("as the host", () => {
    it("shows the player list and allows starting solo, with a hint to wait for others", () => {
      mockSocket({ lobby: lobbySnapshot({ players: [HOST] }) });
      renderAsPlayer("host-1");

      expect(screen.getByText("1 player at the table")).toBeInTheDocument();
      expect(screen.getByText("Start once everyone at the table has joined.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();
    });

    it("keeps Start enabled once a second player has joined", () => {
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

  describe("once the game has ended", () => {
    it("renders the game-over summary instead of falling back to the waiting-room lobby card", () => {
      // Regression test: this page used to gate GameBoard on
      // status === "playing" only, so an auto-ended game (CLAUDE.md
      // "Game-end condition") fell through to the pre-game waiting-room
      // view (share link, "Start game" button) instead of a game-over
      // screen.
      mockSocket({
        lobby: lobbySnapshot({
          status: "ended",
          players: [HOST, GUEST],
          bankCount: 0,
        }),
      });
      renderAsPlayer("host-1");

      expect(screen.getByText("Game over.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Start game/ })).not.toBeInTheDocument();
    });
  });

  describe("as an unjoined guest", () => {
    it("sends JoinGame with the signed-in player's identity when Join is clicked", async () => {
      mockSocket({ lobby: lobbySnapshot({ players: [HOST] }) });
      renderAsPlayer("guest-1");

      const joinButton = screen.getByRole("button", { name: "Join game" });
      expect(joinButton).toBeEnabled();

      await userEvent.click(joinButton);

      expect(send).toHaveBeenCalledWith({
        type: "JoinGame",
        commandId: "cmd-1",
        gameId: "ABCDE",
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
