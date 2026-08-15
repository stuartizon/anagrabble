import type * as ReactRouterDom from "react-router-dom";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LobbySnapshot, PlayerState } from "@anagrabble/protocol";
import { mockSignedOutClerk } from "../testUtils/clerkTestMock";
import { GameOverSummary } from "./GameOverSummary";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../auth", () => mockSignedOutClerk());

function player(overrides: Partial<PlayerState>): PlayerState {
  return { id: "p", name: "Player", words: [], score: 0, ...overrides };
}

function lobbySnapshot(players: PlayerState[]): LobbySnapshot {
  return {
    gameId: "ABCDE",
    hostId: players[0]?.id ?? "p",
    status: "ended",
    seq: 5,
    config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
    turnPlayerId: null,
    turnDeadline: null,
    endGameDeadline: null,
    bankCount: 0,
    pool: [],
    players,
  };
}

describe("GameOverSummary", () => {
  it("ranks players by score descending and shows a single winner line", () => {
    const sam = player({ id: "sam-1", name: "Sam", score: 8, words: ["STARE", "CAST"] });
    const me = player({ id: "me-1", name: "Me", score: 3, words: ["ARC"] });
    render(
      <MemoryRouter>
        <GameOverSummary lobby={lobbySnapshot([me, sam])} playerId="me-1" />
      </MemoryRouter>,
    );

    const names = screen.getAllByTestId("summary-player-name").map((el) => el.textContent);
    expect(names).toEqual(["Sam", "Me"]);
    expect(screen.getByText("Sam wins with 8.")).toBeInTheDocument();
    expect(screen.getByText("STARE")).toBeInTheDocument();
    expect(screen.getByText("CAST")).toBeInTheDocument();
    expect(screen.getByText("ARC")).toBeInTheDocument();
  });

  it("shows a tie line and equal ranks when the top score is shared", () => {
    const sam = player({ id: "sam-1", name: "Sam", score: 6 });
    const jo = player({ id: "jo-1", name: "Jo", score: 6 });
    const lee = player({ id: "lee-1", name: "Lee", score: 2 });
    render(
      <MemoryRouter>
        <GameOverSummary lobby={lobbySnapshot([sam, jo, lee])} playerId="sam-1" />
      </MemoryRouter>,
    );

    expect(screen.getByText("Sam and Jo tie at 6.")).toBeInTheDocument();
    const ranks = screen.getAllByTestId("summary-player-rank").map((el) => el.textContent);
    expect(ranks).toEqual(["1", "1", "3"]);
  });

  it("navigates to the new-game form when New game is clicked", async () => {
    const me = player({ id: "me-1", name: "Me", score: 3 });
    render(
      <MemoryRouter>
        <GameOverSummary lobby={lobbySnapshot([me])} playerId="me-1" />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New game" }));
    expect(navigateMock).toHaveBeenCalledWith("/new");
  });

  it("navigates to the stats page when View your stats is clicked", async () => {
    const me = player({ id: "me-1", name: "Me", score: 3 });
    render(
      <MemoryRouter>
        <GameOverSummary lobby={lobbySnapshot([me])} playerId="me-1" />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "View your stats" }));
    expect(navigateMock).toHaveBeenCalledWith("/stats");
  });
});
