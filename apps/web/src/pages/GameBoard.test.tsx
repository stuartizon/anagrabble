import { MemoryRouter } from "react-router-dom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbySnapshot, PlayerState } from "@anagrabble/protocol";
import type { GameSocketError, WordPlayNarration } from "../useGameSocket";
import { GameBoard } from "./GameBoard";

const send = vi.fn();
const makeCommandIdMock = vi.fn(() => "cmd-1");

vi.mock("../gameId", () => ({
  makeCommandId: () => makeCommandIdMock(),
}));

const ME: PlayerState = { id: "me-1", name: "Me", words: [], score: 0 };
const OPPONENT: PlayerState = { id: "opp-1", name: "Sam", words: [], score: 0 };

function lobbySnapshot(overrides: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    gameId: "ABCDE",
    hostId: "me-1",
    status: "playing",
    seq: 1,
    config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
    turnPlayerIndex: 0,
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
  history?: WordPlayNarration[];
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
        history={props.history ?? []}
      />
    </MemoryRouter>
  );
}

function renderBoard(props: BoardProps = {}) {
  return render(boardElement(props));
}

beforeEach(() => {
  send.mockClear();
  makeCommandIdMock.mockReset();
  makeCommandIdMock.mockReturnValue("cmd-1");
});

describe("GameBoard", () => {
  it("shows empty-state copy for both word lists when nobody has played yet", () => {
    renderBoard();
    expect(screen.getAllByText("No words yet")).toHaveLength(2);
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
    expect(screen.queryAllByText("No words yet")).toHaveLength(0);
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

  it("shows the invite link in the sidebar, positioned after Players and before History", () => {
    renderBoard();

    expect(screen.getByText(`${window.location.origin}/ABCDE`)).toBeInTheDocument();

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
      playerId: "me-1",
      word: "cat",
    });
    expect(input).toHaveValue("");
  });

  it("submits on Enter inside the word input", async () => {
    renderBoard();

    const input = screen.getByPlaceholderText("Type a word…");
    await userEvent.type(input, "cat{Enter}");

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "SubmitWord", word: "cat" }));
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

    expect(screen.getByText("XYZZY isn't in the dictionary.")).toBeInTheDocument();
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

    expect(screen.getByText("FIRST isn't in the dictionary.")).toBeInTheDocument();
    expect(screen.queryByText("SECOND isn't in the dictionary.")).not.toBeInTheDocument();
  });

  it("includes this game's minWordLength in the TooShort message", () => {
    renderBoard({
      lobby: lobbySnapshot({ config: { turnTimerSec: 30, minWordLength: 5, language: "English" } }),
      error: { code: "TooShort", message: "raw server message" },
    });

    expect(screen.getByText("Words need to be at least 5 letters.")).toBeInTheDocument();
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

    expect(screen.getByText("That's not a legal move right now.")).toBeInTheDocument();
  });

  it("shows distinct copy for DerivationBlocked, not the generic 'not a legal move' text", () => {
    renderBoard({ error: { code: "DerivationBlocked", message: "raw server message" } });

    expect(screen.getByText("You have to change the root.")).toBeInTheDocument();
    expect(screen.queryByText("That's not a legal move right now.")).not.toBeInTheDocument();
  });

  it("falls back to the server's message for an unmapped error code", () => {
    renderBoard({ error: { code: "SomethingElse", message: "raw server message" } });

    expect(screen.getByText("raw server message")).toBeInTheDocument();
  });

  it("shows empty-state copy for history when nobody has played yet", () => {
    renderBoard();

    expect(screen.getByText("No words played yet.")).toBeInTheDocument();
  });

  it("opens the mobile menu with players and invite link (no history — not part of the design's mobile menu), and closes via the close button", async () => {
    renderBoard({
      lobby: lobbySnapshot({
        players: [
          { ...ME, score: 4 },
          { ...OPPONENT, score: 7 },
        ],
      }),
      history: [{ seq: 2, playerId: "me-1", word: "TAR", usedWords: [] }],
    });

    expect(screen.queryByTestId("mobile-menu")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Menu" }));

    const menu = within(screen.getByTestId("mobile-menu"));
    expect(menu.getByText("Players")).toBeInTheDocument();
    expect(menu.getByText(`${window.location.origin}/ABCDE`)).toBeInTheDocument();
    expect(menu.queryByText("History")).not.toBeInTheDocument();
    expect(menu.queryByText("Me played TAR")).not.toBeInTheDocument();

    await userEvent.click(menu.getByRole("button", { name: "Close" }));

    expect(screen.queryByTestId("mobile-menu")).not.toBeInTheDocument();
  });

  it("lists history entries newest-first, narrated in the third person for every player", () => {
    renderBoard({
      history: [
        { seq: 2, playerId: "me-1", word: "TAR", usedWords: [] },
        { seq: 3, playerId: "opp-1", word: "CAST", usedWords: [{ word: "CAT", ownerId: "me-1" }] },
      ],
    });

    const entries = screen.getAllByText(/played|stole/);
    expect(entries.map((e) => e.textContent)).toEqual([
      "Sam stole CAT from Me → CAST",
      "Me played TAR",
    ]);
  });
});
