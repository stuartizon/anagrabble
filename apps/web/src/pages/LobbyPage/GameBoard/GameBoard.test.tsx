import { MemoryRouter } from "react-router-dom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbySnapshot, PlayerState, PlayerSettingsResponse } from "@anagrabble/protocol";
import type {
  GameSocketError,
  HistoryEntry,
  SocketStatus,
  WordPlayNarration,
} from "../../../useGameSocket";
import { mockSignedOutClerk } from "../../../testUtils/clerkTestMock";
import { GameBoard } from "./index";
import styles from "./PlayersSection.module.css";

const send = vi.fn();
const onLeaveGame = vi.fn();
const playSound = vi.fn();
const vibrate = vi.fn();
const onUpdatePlayerSettings = vi.fn();
const makeCommandIdMock = vi.fn(() => "cmd-1");

function playerSettings(overrides: Partial<PlayerSettingsResponse> = {}): PlayerSettingsResponse {
  return { language: "English", soundEnabled: true, hapticsEnabled: false, ...overrides };
}

vi.mock("../../../gameId", () => ({
  makeCommandId: () => makeCommandIdMock(),
}));

vi.mock("../../../auth", () => mockSignedOutClerk());

const ME: PlayerState = { id: "me-1", name: "Me", words: [], score: 0 };
const OPPONENT: PlayerState = { id: "opp-1", name: "Sam", words: [], score: 0 };

function lobbySnapshot(overrides: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    gameId: "ABCDE",
    hostId: "me-1",
    status: "playing",
    seq: 1,
    config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
    turnPlayerId: "me-1",
    turnDeadline: Date.now() + 30_000,
    endGameDeadline: null,
    bankCount: 100,
    pool: ["C", "A", "T"],
    players: [ME, OPPONENT],
    ...overrides,
  };
}

type BoardProps = {
  lobby?: LobbySnapshot;
  error?: GameSocketError | null;
  wordPlay?: WordPlayNarration | null;
  history?: HistoryEntry[];
  status?: SocketStatus;
  leaving?: boolean;
  leaveError?: string | null;
  playerSettings?: PlayerSettingsResponse | null;
  playerSettingsSaveError?: boolean;
};

function boardElement(props: BoardProps = {}) {
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GameBoard
        lobby={props.lobby ?? lobbySnapshot()}
        playerId="me-1"
        send={send}
        error={props.error ?? null}
        wordPlay={props.wordPlay ?? null}
        playSound={playSound}
        vibrate={vibrate}
        history={props.history ?? []}
        status={props.status ?? "open"}
        onLeaveGame={onLeaveGame}
        leaving={props.leaving ?? false}
        leaveError={props.leaveError ?? null}
        playerSettings={
          props.playerSettings === undefined ? playerSettings() : props.playerSettings
        }
        onUpdatePlayerSettings={onUpdatePlayerSettings}
        playerSettingsSaveError={props.playerSettingsSaveError ?? false}
      />
    </MemoryRouter>
  );
}

function renderBoard(props: BoardProps = {}) {
  return render(boardElement(props));
}

beforeEach(() => {
  send.mockClear();
  onLeaveGame.mockClear();
  playSound.mockClear();
  vibrate.mockClear();
  onUpdatePlayerSettings.mockClear();
  makeCommandIdMock.mockReset();
  makeCommandIdMock.mockReturnValue("cmd-1");
});

describe("GameBoard", () => {
  it("shows empty-state copy for both word lists when nobody has played yet", () => {
    renderBoard();
    expect(screen.getAllByText("No words")).toHaveLength(2);
  });

  it("lists the viewer's own words under 'Your words' and others separately", () => {
    renderBoard({
      lobby: lobbySnapshot({
        players: [
          { ...ME, words: ["CAT"], score: 1 },
          { ...OPPONENT, words: ["TAR"], score: 1 },
        ],
      }),
    });

    expect(screen.getByText("CAT")).toBeInTheDocument();
    expect(screen.getByText("TAR")).toBeInTheDocument();
    expect(screen.getByText("Your words")).toBeInTheDocument();
    expect(screen.getByText("Everyone else’s words")).toBeInTheDocument();
  });

  it("hides the 'Everyone else's words' section in a solo game", () => {
    renderBoard({
      lobby: lobbySnapshot({ players: [{ ...ME, words: ["CAT"], score: 1 }] }),
    });

    expect(screen.getByText("Your words")).toBeInTheDocument();
    expect(screen.queryByText("Everyone else’s words")).not.toBeInTheDocument();
    expect(screen.queryAllByText("No words")).toHaveLength(0);
  });

  it("lists players in the sidebar with their name and score, in turn order", () => {
    renderBoard({
      lobby: lobbySnapshot({
        players: [
          { ...ME, score: 4 },
          { ...OPPONENT, score: 7 },
        ],
      }),
    });

    const names = screen.getAllByTestId("sidebar-player-name").map((el) => el.textContent);
    expect(names).toEqual(["Me", "Sam"]);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows no away indicator for a connected player", () => {
    renderBoard({
      lobby: lobbySnapshot({ players: [{ ...ME }, { ...OPPONENT, presence: "connected" }] }),
    });

    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
    const names = screen.getAllByTestId("sidebar-player-name");
    expect(names[1].parentElement).not.toHaveAttribute("title");
  });

  it("marks a disconnected player's row as away via a title tooltip and muted styling, with no visible icon or text", () => {
    renderBoard({
      lobby: lobbySnapshot({ players: [{ ...ME }, { ...OPPONENT, presence: "disconnected" }] }),
    });

    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
    const names = screen.getAllByTestId("sidebar-player-name");
    const opponentRow = names[1].parentElement as HTMLElement;
    expect(opponentRow).toHaveAttribute("title", "Disconnected");
    expect(opponentRow.querySelector("svg")).toBeNull();
  });

  it("hollows out a non-connected player's color swatch to a ring instead of a filled dot", () => {
    renderBoard({
      lobby: lobbySnapshot({ players: [{ ...ME }, { ...OPPONENT, presence: "disconnected" }] }),
    });

    const names = screen.getAllByTestId("sidebar-player-name");
    const opponentDot = names[1].previousElementSibling as HTMLElement;
    expect(opponentDot.className).toContain(styles.playerDotMuted);
    const meDot = names[0].previousElementSibling as HTMLElement;
    expect(meDot.className).not.toContain(styles.playerDotMuted);
  });

  it("shows the invite code in the sidebar, positioned after Players and before History", () => {
    renderBoard();

    expect(screen.getByText("ABCDE")).toBeInTheDocument();

    const sidebarText = document.body.textContent ?? "";
    const playersIdx = sidebarText.indexOf("Players");
    const inviteIdx = sidebarText.indexOf("Invite");
    const historyIdx = sidebarText.indexOf("History");
    expect(playersIdx).toBeGreaterThanOrEqual(0);
    expect(playersIdx).toBeLessThan(inviteIdx);
    expect(inviteIdx).toBeLessThan(historyIdx);
  });

  it("copies the invite link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderBoard();

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/ABCDE`);
  });

  it("sends SubmitWord with the typed word and clears the input", async () => {
    renderBoard();

    const input = screen.getByPlaceholderText("Type a word…");
    await userEvent.type(input, "cat");
    await userEvent.click(screen.getByRole("button", { name: "Play word" }));

    expect(send).toHaveBeenCalledWith({
      type: "SubmitWord",
      commandId: "cmd-1",
      gameId: "ABCDE",
      word: "CAT",
    });
    expect(input).toHaveValue("");
  });

  it("submits on Enter inside the word input", async () => {
    renderBoard();

    const input = screen.getByPlaceholderText("Type a word…");
    await userEvent.type(input, "cat{Enter}");

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "SubmitWord", word: "CAT" }));
  });

  it("uppercases input and strips non-letter characters as the user types", async () => {
    renderBoard();

    const input = screen.getByPlaceholderText("Type a word…");
    await userEvent.type(input, "ca7 t's!");

    expect(input).toHaveValue("CATS");
  });

  it("does not submit a blank or whitespace-only word", async () => {
    renderBoard();

    await userEvent.type(screen.getByPlaceholderText("Type a word…"), "   {Enter}");

    expect(send).not.toHaveBeenCalled();
  });

  it("narrates a steal when the word play used an opponent's word", () => {
    renderBoard({
      wordPlay: {
        seq: 2,
        playerId: "me-1",
        word: "CAST",
        usedWords: [{ word: "CAT", ownerId: "opp-1" }],
      },
    });

    expect(screen.getByText("You stole CAT from Sam → CAST")).toBeInTheDocument();
  });

  it("narrates the viewer's own plain play (no steal)", () => {
    renderBoard({
      wordPlay: { seq: 2, playerId: "me-1", word: "TAR", usedWords: [] },
    });

    expect(screen.getByText("You played TAR")).toBeInTheDocument();
  });

  it("narrates the viewer extending their own word, not just the result", () => {
    renderBoard({
      wordPlay: {
        seq: 2,
        playerId: "me-1",
        word: "BADGE",
        usedWords: [{ word: "BAD", ownerId: "me-1" }],
      },
    });

    expect(screen.getByText("You played BAD → BADGE")).toBeInTheDocument();
  });

  it("narrates a steal that combines words from two different opponents", () => {
    renderBoard({
      lobby: lobbySnapshot({
        players: [ME, OPPONENT, { id: "third-1", name: "Ash", words: [], score: 0 }],
      }),
      wordPlay: {
        seq: 2,
        playerId: "me-1",
        word: "CATDOG",
        usedWords: [
          { word: "CAT", ownerId: "opp-1" },
          { word: "DOG", ownerId: "third-1" },
        ],
      },
    });

    expect(screen.getByText("You stole CAT from Sam + DOG from Ash → CATDOG")).toBeInTheDocument();
  });

  it("narrates a steal that combines an opponent's word with the viewer's own", () => {
    renderBoard({
      wordPlay: {
        seq: 2,
        playerId: "me-1",
        word: "CATBAD",
        usedWords: [
          { word: "CAT", ownerId: "opp-1" },
          { word: "BAD", ownerId: "me-1" },
        ],
      },
    });

    expect(screen.getByText("You stole CAT from Sam + BAD → CATBAD")).toBeInTheDocument();
  });

  it("does not resurrect a dismissed toast when the lobby snapshot updates afterward (e.g. a tile turn)", () => {
    // Regression test: the toast effect used to depend on the whole `lobby`
    // object, which gets a new reference on every snapshot update (not just
    // WordPlayed). A lobby update arriving after the toast's own dismiss
    // timer had already fired was re-running the effect against the same,
    // still-not-null `wordPlay` and showing it again.
    vi.useFakeTimers();
    try {
      const wordPlay: WordPlayNarration = {
        seq: 2,
        playerId: "me-1",
        word: "TAR",
        usedWords: [],
      };
      const { rerender } = render(boardElement({ wordPlay }));
      expect(screen.getByText("You played TAR")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.queryByText("You played TAR")).not.toBeInTheDocument();

      // Same wordPlay reference, but a fresh lobby object — as happens on a
      // TileTurned/LobbyState update after the play.
      rerender(boardElement({ wordPlay, lobby: lobbySnapshot({ bankCount: 99 }) }));

      expect(screen.queryByText("You played TAR")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no toast for another player's play — that's shared/ambient, not personal to this screen", () => {
    renderBoard({
      wordPlay: { seq: 2, playerId: "opp-1", word: "TAR", usedWords: [] },
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("plays the claim sound for any word play, including another player's — unlike the toast, it's not personal-only", () => {
    renderBoard({
      wordPlay: { seq: 2, playerId: "opp-1", word: "TAR", usedWords: [] },
    });

    expect(playSound).toHaveBeenCalledWith("wordClaim");
    expect(vibrate).toHaveBeenCalledWith("wordClaim");
  });

  it("shows no toast when another player steals from a third player", () => {
    renderBoard({
      lobby: lobbySnapshot({
        players: [ME, OPPONENT, { id: "third-1", name: "Ash", words: [], score: 0 }],
      }),
      wordPlay: {
        seq: 2,
        playerId: "opp-1",
        word: "CAST",
        usedWords: [{ word: "CAT", ownerId: "third-1" }],
      },
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows friendly copy for a known rejection code, naming the word that was actually attempted", async () => {
    const { rerender } = renderBoard();
    await userEvent.type(screen.getByPlaceholderText("Type a word…"), "xyzzy{Enter}");

    rerender(
      boardElement({
        error: { code: "NotAWord", message: "raw server message", commandId: "cmd-1" },
      }),
    );

    expect(screen.getByText("XYZZY isn't in the dictionary")).toBeInTheDocument();
    expect(playSound).toHaveBeenCalledWith("wordRejected");
    expect(vibrate).toHaveBeenCalledWith("wordRejected");
  });

  it("plays no sound or haptic for a suppressed NotYourTurn rejection (never shown as a toast either)", () => {
    renderBoard({ error: { code: "NotYourTurn", message: "raw server message" } });

    expect(playSound).not.toHaveBeenCalledWith("wordRejected");
    expect(vibrate).not.toHaveBeenCalledWith("wordRejected");
  });

  it("correlates a rejection to the word that actually caused it, not whichever was typed most recently", async () => {
    // Two submissions before any response comes back — the error names the
    // FIRST word (whose commandId it actually carries), not the second one
    // sitting in the input/ref by the time the rejection arrives. This is
    // exactly the race a "remember the last submitted word" approach gets
    // wrong (see docs/decisions.md "Rejection messages correlate by
    // commandId, not 'last submitted'").
    const { rerender } = renderBoard();
    const input = screen.getByPlaceholderText("Type a word…");

    makeCommandIdMock.mockReturnValueOnce("cmd-a");
    await userEvent.type(input, "first{Enter}");
    makeCommandIdMock.mockReturnValueOnce("cmd-b");
    await userEvent.type(input, "second{Enter}");

    rerender(
      boardElement({
        error: { code: "NotAWord", message: "raw server message", commandId: "cmd-a" },
      }),
    );

    expect(screen.getByText("FIRST isn't in the dictionary")).toBeInTheDocument();
    expect(screen.queryByText("SECOND isn't in the dictionary")).not.toBeInTheDocument();
  });

  it("includes this game's minWordLength in the TooShort message", () => {
    renderBoard({
      lobby: lobbySnapshot({ config: { turnTimerSec: 30, minWordLength: 5, language: "English" } }),
      error: { code: "TooShort", message: "raw server message" },
    });

    expect(screen.getByText("Words need to be at least 5 letters")).toBeInTheDocument();
  });

  it("never shows a message for NotYourTurn (only reachable via the background auto-fire race, not a player action)", () => {
    renderBoard({ error: { code: "NotYourTurn", message: "raw server message" } });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the same 'not a legal move' copy for StaleState as for NoDecomposition", () => {
    // From the player's side these are the same outcome, just caught by
    // different backend layers depending on timing — see errorText's
    // doc comment.
    renderBoard({ error: { code: "StaleState", message: "raw server message" } });

    expect(screen.getByText("That's not a legal move")).toBeInTheDocument();
  });

  it("shows distinct copy for DerivationBlocked, not the generic 'not a legal move' text", () => {
    renderBoard({ error: { code: "DerivationBlocked", message: "raw server message" } });

    expect(screen.getByText("You have to change the root")).toBeInTheDocument();
    expect(screen.queryByText("That's not a legal move")).not.toBeInTheDocument();
  });

  it("falls back to the server's message for an unmapped error code", () => {
    renderBoard({ error: { code: "SomethingElse", message: "raw server message" } });

    expect(screen.getByText("raw server message")).toBeInTheDocument();
  });

  it("shows empty-state copy for history when nothing has happened yet", () => {
    renderBoard();

    expect(screen.getByText("Nothing has happened yet.")).toBeInTheDocument();
  });

  it("opens the mobile menu with players and invite link (no history — not part of the design's mobile menu), and closes via the close button", async () => {
    renderBoard({
      lobby: lobbySnapshot({
        players: [
          { ...ME, score: 4 },
          { ...OPPONENT, score: 7 },
        ],
      }),
      history: [{ kind: "wordPlay", seq: 2, playerId: "me-1", word: "TAR", usedWords: [] }],
    });

    expect(screen.queryByTestId("mobile-menu")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Menu" }));

    const menu = within(screen.getByTestId("mobile-menu"));
    expect(menu.getByText("Players")).toBeInTheDocument();
    expect(menu.getByText("ABCDE")).toBeInTheDocument();
    expect(menu.queryByText("History")).not.toBeInTheDocument();
    expect(menu.queryByText("Me played TAR")).not.toBeInTheDocument();

    await userEvent.click(menu.getByRole("button", { name: "Close" }));

    expect(screen.queryByTestId("mobile-menu")).not.toBeInTheDocument();
  });

  it("orders the mobile menu as Players, Invite, Your settings, then Game settings", async () => {
    renderBoard();

    await userEvent.click(screen.getByRole("button", { name: "Menu" }));

    const menuText = screen.getByTestId("mobile-menu").textContent ?? "";
    const playersIdx = menuText.indexOf("Players");
    const inviteIdx = menuText.indexOf("Invite code");
    const yourSettingsIdx = menuText.indexOf("Your settings");
    const gameSettingsIdx = menuText.indexOf("Game settings");
    expect(playersIdx).toBeGreaterThanOrEqual(0);
    expect(playersIdx).toBeLessThan(inviteIdx);
    expect(inviteIdx).toBeLessThan(yourSettingsIdx);
    expect(yourSettingsIdx).toBeLessThan(gameSettingsIdx);
  });

  describe("your settings (mobile menu)", () => {
    it("shows the player's settings alongside game settings", async () => {
      renderBoard({
        playerSettings: playerSettings({ soundEnabled: true, hapticsEnabled: false }),
      });

      await userEvent.click(screen.getByRole("button", { name: "Menu" }));
      const menu = within(screen.getByTestId("mobile-menu"));

      expect(menu.getByText("Your settings")).toBeInTheDocument();
      expect(menu.getByRole("switch", { name: "Sound effects" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(menu.getByRole("switch", { name: "Haptic feedback" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    it("updates settings immediately when toggled, without leaving the game", async () => {
      renderBoard({
        playerSettings: playerSettings({ soundEnabled: true, hapticsEnabled: false }),
      });

      await userEvent.click(screen.getByRole("button", { name: "Menu" }));
      const menu = within(screen.getByTestId("mobile-menu"));

      await userEvent.click(menu.getByRole("switch", { name: "Sound effects" }));
      expect(onUpdatePlayerSettings).toHaveBeenCalledWith(
        playerSettings({ soundEnabled: false, hapticsEnabled: false }),
      );

      await userEvent.click(menu.getByRole("switch", { name: "Haptic feedback" }));
      expect(onUpdatePlayerSettings).toHaveBeenCalledWith(
        playerSettings({ soundEnabled: true, hapticsEnabled: true }),
      );
    });

    it("hides the section while the player's settings haven't loaded", async () => {
      renderBoard({ playerSettings: null });

      await userEvent.click(screen.getByRole("button", { name: "Menu" }));
      const menu = within(screen.getByTestId("mobile-menu"));

      expect(menu.queryByText("Your settings")).not.toBeInTheDocument();
    });

    it("shows an error if saving a settings change fails", async () => {
      renderBoard({ playerSettingsSaveError: true });

      await userEvent.click(screen.getByRole("button", { name: "Menu" }));
      const menu = within(screen.getByTestId("mobile-menu"));

      expect(menu.getByText("Couldn't save your changes.")).toBeInTheDocument();
    });
  });

  describe("settings modal (desktop)", () => {
    it("opens via the settings cog with your settings then game settings, and closes via the close button", async () => {
      renderBoard();

      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));

      const dialogElement = screen.getByRole("dialog", { name: "Settings" });
      const modal = within(dialogElement);
      expect(modal.getByText("Your settings")).toBeInTheDocument();
      expect(modal.getByText("Game settings")).toBeInTheDocument();
      const modalText = dialogElement.textContent ?? "";
      expect(modalText.indexOf("Your settings")).toBeLessThan(modalText.indexOf("Game settings"));

      await userEvent.click(modal.getByRole("button", { name: "Close" }));

      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    });

    it("closes when clicking the backdrop", async () => {
      renderBoard();

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("dialog", { name: "Settings" }).parentElement!);

      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    });

    it("omits the invite code and player list — already visible in the sidebar", async () => {
      renderBoard();

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));
      const modal = within(screen.getByRole("dialog", { name: "Settings" }));

      expect(modal.queryByText("Invite code")).not.toBeInTheDocument();
      expect(modal.queryByText("Players")).not.toBeInTheDocument();
    });

    it("shows the player's sound setting, without haptics — nothing to toggle on desktop", async () => {
      renderBoard({
        playerSettings: playerSettings({ soundEnabled: true, hapticsEnabled: false }),
      });

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));
      const modal = within(screen.getByRole("dialog", { name: "Settings" }));

      expect(modal.getByRole("switch", { name: "Sound effects" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(modal.queryByRole("switch", { name: "Haptic feedback" })).not.toBeInTheDocument();
    });

    it("updates settings immediately when toggled, without leaving the game", async () => {
      renderBoard({
        playerSettings: playerSettings({ soundEnabled: true, hapticsEnabled: false }),
      });

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));
      const modal = within(screen.getByRole("dialog", { name: "Settings" }));

      await userEvent.click(modal.getByRole("switch", { name: "Sound effects" }));
      expect(onUpdatePlayerSettings).toHaveBeenCalledWith(
        playerSettings({ soundEnabled: false, hapticsEnabled: false }),
      );
    });

    it("hides the your-settings section while the player's settings haven't loaded", async () => {
      renderBoard({ playerSettings: null });

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));
      const modal = within(screen.getByRole("dialog", { name: "Settings" }));

      expect(modal.queryByText("Your settings")).not.toBeInTheDocument();
      expect(modal.getByText("Game settings")).toBeInTheDocument();
    });

    it("shows an error if saving a settings change fails", async () => {
      renderBoard({ playerSettingsSaveError: true });

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));
      const modal = within(screen.getByRole("dialog", { name: "Settings" }));

      expect(modal.getByText("Couldn't save your changes.")).toBeInTheDocument();
    });

    it("shows the read-only game settings", async () => {
      renderBoard({
        lobby: lobbySnapshot({
          config: { turnTimerSec: 45, minWordLength: 4, language: "English" },
        }),
      });

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));
      const modal = within(screen.getByRole("dialog", { name: "Settings" }));

      expect(modal.getByText("45s")).toBeInTheDocument();
      expect(modal.getByText("4 letters")).toBeInTheDocument();
    });
  });

  it("shows no account status anywhere while playing — not in the design's header or mobile menu", async () => {
    renderBoard({});

    expect(screen.queryByText("Log in")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Menu" }));

    const menu = within(screen.getByTestId("mobile-menu"));
    expect(menu.queryByText("Account")).not.toBeInTheDocument();
    expect(menu.queryByText("Log in")).not.toBeInTheDocument();
  });

  it("lists history entries newest-first, narrated in the third person for every player", () => {
    renderBoard({
      history: [
        { kind: "wordPlay", seq: 2, playerId: "me-1", word: "TAR", usedWords: [] },
        {
          kind: "wordPlay",
          seq: 3,
          playerId: "opp-1",
          word: "CAST",
          usedWords: [{ word: "CAT", ownerId: "me-1" }],
        },
      ],
    });

    const entries = screen.getAllByText(/played|stole/);
    expect(entries.map((e) => e.textContent)).toEqual([
      "Sam stole CAT from Me → CAST",
      "Me played TAR",
    ]);
  });

  it("narrates a player joining the game in the history panel", () => {
    renderBoard({
      history: [
        { kind: "wordPlay", seq: 2, playerId: "me-1", word: "TAR", usedWords: [] },
        { kind: "playerJoined", seq: 3, playerId: "opp-1" },
      ],
    });

    const rows = screen.getAllByText(/played|joined/);
    expect(rows.map((r) => r.textContent)).toEqual(["Sam joined the game", "Me played TAR"]);
  });

  it("shows the idle countdown once the bank is empty but the game is still playing", () => {
    renderBoard({
      lobby: lobbySnapshot({
        status: "playing",
        bankCount: 0,
        endGameDeadline: Date.now() + 45_000,
      }),
    });

    const countdown = screen.getByTestId("end-game-countdown");
    expect(countdown).toHaveTextContent("Game ends in");
    expect(countdown).toHaveTextContent("45s");
    expect(screen.queryByText("No more tiles.")).not.toBeInTheDocument();
  });

  it("falls back to plain 'No more tiles.' copy once the game has ended (no countdown left to show)", () => {
    renderBoard({ lobby: lobbySnapshot({ status: "ended", bankCount: 0 }) });

    expect(screen.queryByTestId("end-game-countdown")).not.toBeInTheDocument();
    expect(screen.getByText("No more tiles.")).toBeInTheDocument();
  });

  it("fires EndGame once the idle countdown deadline has passed", () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      renderBoard({
        lobby: lobbySnapshot({ bankCount: 0, endGameDeadline: now + 1000 }),
      });

      act(() => {
        vi.advanceTimersByTime(1250);
      });

      expect(send).toHaveBeenCalledWith({
        type: "EndGame",
        commandId: "cmd-1",
        gameId: "ABCDE",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire EndGame once the game has already ended", () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      renderBoard({
        lobby: lobbySnapshot({ status: "ended", bankCount: 0, endGameDeadline: now - 1 }),
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "EndGame" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires TurnTile immediately once the current player is disconnected, without waiting for turnDeadline", () => {
    // Regression test: the background auto-fire effect only ever checked
    // Date.now() >= turnDeadline, so the server's fast-skip-on-disconnect
    // accept branch (apply_turn_tile.lua) had no client path that could
    // ever reach it before the full turnTimerSec elapsed.
    renderBoard({
      lobby: lobbySnapshot({
        turnPlayerId: "opp-1",
        turnDeadline: Date.now() + 30_000, // far away — not why this fires
        players: [ME, { ...OPPONENT, presence: "disconnected" }],
      }),
    });

    expect(send).toHaveBeenCalledWith({
      type: "TurnTile",
      commandId: "cmd-1",
      gameId: "ABCDE",
      observedTurnDeadline: expect.any(Number),
    });
  });

  it("does not fire TurnTile early while the current player is still connected", () => {
    renderBoard({
      lobby: lobbySnapshot({
        turnPlayerId: "opp-1",
        turnDeadline: Date.now() + 30_000,
        players: [ME, { ...OPPONENT, presence: "connected" }],
      }),
    });

    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "TurnTile" }));
  });

  it("shows a reconnecting indicator when the socket is reconnecting", () => {
    renderBoard({ status: "reconnecting" });
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });

  it("shows no reconnecting indicator while the socket is open", () => {
    renderBoard({ status: "open" });
    expect(screen.queryByText(/reconnecting/i)).not.toBeInTheDocument();
  });

  describe("leave game", () => {
    it("opens the confirm dialog from the desktop header's Leave game button", async () => {
      renderBoard();

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));

      expect(screen.getByRole("dialog", { name: "Leave this game?" })).toBeInTheDocument();
    });

    it("opens the confirm dialog from the mobile menu's Leave game button, closing the mobile menu underneath it", async () => {
      renderBoard();

      await userEvent.click(screen.getByRole("button", { name: "Menu" }));
      const menu = within(screen.getByTestId("mobile-menu"));
      await userEvent.click(menu.getByRole("button", { name: "Leave game" }));

      expect(screen.getByRole("dialog", { name: "Leave this game?" })).toBeInTheDocument();
      // Not dialog-over-menu-over-board — the mobile menu closes underneath,
      // matching design-system/In Game.dc.html's openLeaveConfirm.
      expect(screen.queryByTestId("mobile-menu")).not.toBeInTheDocument();
    });

    it("closes the settings modal underneath when the back-button trap opens the confirm dialog", async () => {
      // Regression test for useLeaveGuard's single `overlay` field: the
      // settings modal has no Leave game button of its own to reach this
      // through, but the back-button trap (popstate) calls openLeaveConfirm
      // regardless of what else is open, so it's the one realistic way a
      // player could have the settings modal open when this fires.
      renderBoard();

      await userEvent.click(screen.getByRole("button", { name: "Settings" }));
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });

      expect(screen.getByRole("dialog", { name: "Leave this game?" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    });

    it("opens the confirm dialog when clicking the wordmark instead of navigating away", async () => {
      renderBoard();

      await userEvent.click(screen.getByRole("link"));

      expect(screen.getByRole("dialog", { name: "Leave this game?" })).toBeInTheDocument();
    });

    it("mentions the game code so a player knows how to rejoin", async () => {
      renderBoard();

      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));

      const dialog = within(screen.getByRole("dialog", { name: "Leave this game?" }));
      expect(dialog.getByText(/ABCDE/)).toBeInTheDocument();
    });

    it("closes the dialog without leaving when 'Keep playing' is clicked", async () => {
      renderBoard();

      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));
      await userEvent.click(screen.getByRole("button", { name: "Keep playing" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(onLeaveGame).not.toHaveBeenCalled();
    });

    it("calls onLeaveGame when confirming from the dialog", async () => {
      renderBoard();

      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));
      const dialog = within(screen.getByRole("dialog", { name: "Leave this game?" }));
      await userEvent.click(dialog.getByRole("button", { name: "Leave game" }));

      expect(onLeaveGame).toHaveBeenCalled();
    });

    it("shows a disabled, pending leave button while the leave request is in flight", async () => {
      renderBoard({ leaving: true });

      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));

      const dialog = within(screen.getByRole("dialog", { name: "Leave this game?" }));
      expect(dialog.getByRole("button", { name: "Leaving…" })).toBeDisabled();
    });

    it("shows an error message in the dialog when leaving fails", async () => {
      renderBoard({ leaveError: "Something went wrong leaving the game. Try again." });

      await userEvent.click(screen.getByRole("button", { name: "Leave game" }));

      expect(
        screen.getByText("Something went wrong leaving the game. Try again."),
      ).toBeInTheDocument();
    });

    it("shows the browser's native leave-site prompt on an actual page unload", () => {
      renderBoard();

      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it("pushes a sentinel history entry on mount so the first back-press trips the trap instead of actually navigating away", () => {
      const lengthBefore = window.history.length;

      renderBoard();

      expect(window.history.length).toBeGreaterThan(lengthBefore);
    });

    it("blocks the browser back button, opening the same confirm dialog instead of navigating away", () => {
      renderBoard();
      const lengthBeforeBack = window.history.length;

      act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });

      expect(screen.getByRole("dialog", { name: "Leave this game?" })).toBeInTheDocument();
      // Re-armed: a fresh sentinel entry went back on top, so the next
      // back-press trips the trap again instead of slipping through.
      expect(window.history.length).toBeGreaterThan(lengthBeforeBack);
    });

    it("re-opens the dialog on a second back-press after 'Keep playing' cancelled the first", async () => {
      renderBoard();
      act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await userEvent.click(screen.getByRole("button", { name: "Keep playing" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });

      expect(screen.getByRole("dialog", { name: "Leave this game?" })).toBeInTheDocument();
    });

    it("calls onLeaveGame when confirming a dialog opened by the back button", async () => {
      renderBoard();
      act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      const dialog = within(screen.getByRole("dialog", { name: "Leave this game?" }));

      await userEvent.click(dialog.getByRole("button", { name: "Leave game" }));

      expect(onLeaveGame).toHaveBeenCalled();
    });
  });
});
