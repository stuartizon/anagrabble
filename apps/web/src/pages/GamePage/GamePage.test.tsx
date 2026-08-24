import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameSnapshot, PlayerState } from "@anagrabble/protocol";
import type { SocketStatus } from "../../hooks/useGameSocket";
import { mockSignedInClerk, setMockClerkIdentity } from "../../testUtils/clerkTestMock";
import { GamePage } from "./index";

const send = vi.fn();
const useGameSocketMock = vi.fn();

vi.mock("../../hooks/useGameSocket", () => ({
  useGameSocket: (...args: unknown[]) => useGameSocketMock(...args),
}));

vi.mock("../../auth", () => mockSignedInClerk());

vi.mock("../../utils/commandId", () => ({
  makeCommandId: () => "cmd-1",
}));

const leaveGameRequest = vi.fn();
vi.mock("../../client/fetchLeaveGame", () => ({
  leaveGame: (...args: unknown[]) => leaveGameRequest(...args),
}));

// GamePage owns player settings (sound engine — anagrabble#36 — and the
// mobile menu's "Your settings" section — anagrabble#40) via
// usePlayerSettings — mocked the same way SettingsPage.test.tsx does, so its
// fetch/save resolve deterministically instead of hitting a real, unmocked
// fetch() in tests.
const fetchPlayerSettings = vi.fn();
const savePlayerSettings = vi.fn();
vi.mock("../../client/fetchPlayerSettings", () => ({
  fetchPlayerSettings: (...args: unknown[]) => fetchPlayerSettings(...args),
  savePlayerSettings: (...args: unknown[]) => savePlayerSettings(...args),
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

function gameSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    gameId: "ABCDE",
    hostId: "host-1",
    status: "lobby",
    seq: 0,
    config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
    turnPlayerId: "host-1",
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
  game?: GameSnapshot | null;
  error?: { code: string; message: string } | null;
}) {
  useGameSocketMock.mockReturnValue({
    status: overrides.status ?? "open",
    game: overrides.game === undefined ? gameSnapshot() : overrides.game,
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
        <Route path="/:gameId" element={<GamePage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  send.mockClear();
  leaveGameRequest.mockReset();
  useGameSocketMock.mockReset();
  mockSocket({});
  fetchPlayerSettings.mockReset();
  fetchPlayerSettings.mockResolvedValue({
    language: "English",
    soundEnabled: true,
    hapticsEnabled: false,
  });
  savePlayerSettings.mockReset();
});

describe("GamePage", () => {
  it("shows a loading indicator while the lobby hasn't loaded yet", () => {
    mockSocket({ game: null });
    renderAsPlayer("host-1");

    expect(screen.queryByText(/game/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("loader")).toBeInTheDocument();
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
      game: gameSnapshot({ players: [HOST, GUEST] }),
      error: { code: "NotAWord", message: "Not a word we know" },
    });
    renderAsPlayer("guest-1");

    expect(screen.queryByText("Game not found")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for the host to start the game…")).toBeInTheDocument();
  });

  it("opens the rules modal from the Review the rules link", async () => {
    mockSocket({ game: gameSnapshot({ players: [HOST] }) });
    renderAsPlayer("host-1");

    await userEvent.click(screen.getByRole("button", { name: "Review the rules" }));

    expect(screen.getByRole("dialog", { name: "Rules" })).toBeInTheDocument();
  });

  describe("as the host", () => {
    it("shows the player list and allows starting solo, with a hint to wait for others", () => {
      mockSocket({ game: gameSnapshot({ players: [HOST] }) });
      renderAsPlayer("host-1");

      expect(screen.getByText("1 player at the table")).toBeInTheDocument();
      expect(screen.getByText("Start once everyone at the table has joined.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();
    });

    it("keeps Start enabled once a second player has joined", () => {
      mockSocket({ game: gameSnapshot({ players: [HOST, GUEST] }) });
      renderAsPlayer("host-1");

      expect(screen.getByText("2 players at the table")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();
    });

    it("marks a disconnected player's row as away via a title tooltip, with no visible icon or text", () => {
      mockSocket({
        game: gameSnapshot({
          players: [
            { ...HOST, presence: "connected" },
            { ...GUEST, presence: "disconnected" },
          ],
        }),
      });
      renderAsPlayer("host-1");

      expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
      const hostRow = screen.getByText("Host").parentElement as HTMLElement;
      expect(hostRow).not.toHaveAttribute("title");
      const guestRow = screen.getByText("Guest").parentElement as HTMLElement;
      expect(guestRow).toHaveAttribute("title", "Disconnected");
      expect(guestRow.querySelector("svg")).toBeNull();
    });

    it("sends StartGame when Start is clicked", async () => {
      mockSocket({ game: gameSnapshot({ players: [HOST, GUEST] }) });
      renderAsPlayer("host-1");

      await userEvent.click(screen.getByRole("button", { name: "Start game" }));

      expect(send).toHaveBeenCalledWith({
        type: "StartGame",
        commandId: "cmd-1",
        gameId: "ABCDE",
      });
    });

    it("can leave via POST /games/:gameId/leave, then navigates home", async () => {
      leaveGameRequest.mockResolvedValue(gameSnapshot({ players: [GUEST] }));
      mockSocket({ game: gameSnapshot({ players: [HOST, GUEST] }) });
      renderAsPlayer("host-1");

      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));

      expect(leaveGameRequest).toHaveBeenCalledWith("test-token", "ABCDE");
      expect(await screen.findByText("Home")).toBeInTheDocument();
    });

    it("shows an error and stays put if leaving fails", async () => {
      leaveGameRequest.mockRejectedValue(new Error("GameNotFound"));
      mockSocket({ game: gameSnapshot({ players: [HOST, GUEST] }) });
      renderAsPlayer("host-1");

      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));

      expect(
        await screen.findByText("Something went wrong leaving the game. Try again."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Leave game" })).toBeEnabled();
    });
  });

  describe("once the game has started", () => {
    it("renders the game board for a joined player", () => {
      mockSocket({
        game: gameSnapshot({
          status: "playing",
          players: [HOST, GUEST],
          bankCount: 143,
          pool: ["A"],
          turnPlayerId: "host-1",
          turnDeadline: Date.now() + 30_000,
        }),
      });
      renderAsPlayer("host-1");

      expect(screen.getByText("143 tiles left")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Start game/ })).not.toBeInTheDocument();
    });

    it("gates an unjoined guest behind a join prompt instead of the game board", async () => {
      mockSocket({
        game: gameSnapshot({
          status: "playing",
          players: [HOST],
          bankCount: 143,
          pool: ["A"],
          turnPlayerId: "host-1",
          turnDeadline: Date.now() + 30_000,
        }),
      });
      renderAsPlayer("guest-1");

      expect(screen.queryByText("143 tiles left")).not.toBeInTheDocument();
      expect(screen.getByText("This game’s already in progress — join in.")).toBeInTheDocument();
      expect(screen.getByText("English")).toBeInTheDocument();
      expect(screen.getByText("3 letters")).toBeInTheDocument();
      expect(screen.getByText("30s")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Review the rules" })).toBeInTheDocument();
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

    it("updates a player setting immediately from the in-game mobile menu, without leaving the game", async () => {
      savePlayerSettings.mockResolvedValue({
        language: "English",
        soundEnabled: false,
        hapticsEnabled: false,
      });
      mockSocket({
        game: gameSnapshot({
          status: "playing",
          players: [HOST, GUEST],
          bankCount: 143,
          pool: ["A"],
          turnPlayerId: "host-1",
          turnDeadline: Date.now() + 30_000,
        }),
      });
      renderAsPlayer("host-1");

      await userEvent.click(screen.getByRole("button", { name: "Menu" }));
      const menu = within(screen.getByTestId("mobile-menu"));
      const soundSwitch = await menu.findByRole("switch", { name: "Sound effects" });
      expect(soundSwitch).toHaveAttribute("aria-checked", "true");

      await userEvent.click(soundSwitch);

      expect(savePlayerSettings).toHaveBeenCalledWith("test-token", {
        language: "English",
        soundEnabled: false,
        hapticsEnabled: false,
      });
      // Same mounted tree throughout — no navigation to /settings and back,
      // proving the mobile-menu toggle takes effect live (anagrabble#40),
      // unlike the pre-#40 fetch-once-on-mount behavior anagrabble#37 flags.
      await waitFor(() => expect(soundSwitch).toHaveAttribute("aria-checked", "false"));
    });

    it("leaving mid-game navigates home directly, without the pre-start REST call", async () => {
      mockSocket({
        game: gameSnapshot({
          status: "playing",
          players: [HOST, GUEST],
          bankCount: 143,
          pool: ["A"],
          turnPlayerId: "host-1",
          turnDeadline: Date.now() + 30_000,
        }),
      });
      renderAsPlayer("host-1");

      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));
      const dialog = within(screen.getByRole("dialog", { name: "Leave this game?" }));
      await userEvent.click(dialog.getByRole("button", { name: "Leave game" }));

      expect(leaveGameRequest).not.toHaveBeenCalled();
      expect(await screen.findByText("Home")).toBeInTheDocument();
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
        game: gameSnapshot({
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
      mockSocket({ game: gameSnapshot({ players: [HOST] }) });
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

    it("has no Leave game button — there's nothing to leave yet", () => {
      mockSocket({ game: gameSnapshot({ players: [HOST] }) });
      renderAsPlayer("guest-1");

      expect(screen.queryByRole("button", { name: "Leave game" })).not.toBeInTheDocument();
    });
  });

  describe("as a joined non-host player", () => {
    it("shows a waiting message and no Join/Start controls", () => {
      mockSocket({ game: gameSnapshot({ players: [HOST, GUEST] }) });
      renderAsPlayer("guest-1");

      expect(screen.getByText("Waiting for the host to start the game…")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Join game" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Start game|Waiting for players/ }),
      ).not.toBeInTheDocument();
    });

    it("can also leave via Leave game", async () => {
      leaveGameRequest.mockResolvedValue(gameSnapshot({ players: [HOST] }));
      mockSocket({ game: gameSnapshot({ players: [HOST, GUEST] }) });
      renderAsPlayer("guest-1");

      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));

      expect(leaveGameRequest).toHaveBeenCalledWith("test-token", "ABCDE");
      expect(await screen.findByText("Home")).toBeInTheDocument();
    });
  });
});
