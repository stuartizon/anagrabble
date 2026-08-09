import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
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

  it("shows each player's score", () => {
    renderBoard({
      lobby: lobbySnapshot({
        players: [
          { ...ME, score: 4 },
          { ...OPPONENT, score: 7 },
        ],
      }),
    });

    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
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

  it("narrates a plain play (no steal) when nothing was taken from another player", () => {
    renderBoard({
      wordPlay: { seq: 2, playerId: "opp-1", word: "TAR", usedWords: [] },
    });

    expect(screen.getByText("Sam played TAR")).toBeInTheDocument();
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

  it("never shows a message for StaleState (the winning player's own success toast already explains it)", () => {
    renderBoard({ error: { code: "StaleState", message: "raw server message" } });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to the server's message for an unmapped error code", () => {
    renderBoard({ error: { code: "SomethingElse", message: "raw server message" } });

    expect(screen.getByText("raw server message")).toBeInTheDocument();
  });
});
