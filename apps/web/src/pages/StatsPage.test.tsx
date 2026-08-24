import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockSignedInClerk } from "../testUtils/clerkTestMock";
import type { PlayerStatsResponse } from "../client/fetchPlayerStats";

vi.mock("../auth", () => mockSignedInClerk());

const fetchPlayerStats = vi.fn();
vi.mock("../client/fetchPlayerStats", () => ({
  fetchPlayerStats: (...args: unknown[]) => fetchPlayerStats(...args),
}));

const { StatsPage } = await import("./StatsPage");

function sampleStats(overrides: Partial<PlayerStatsResponse> = {}): PlayerStatsResponse {
  return {
    gamesPlayed: 2,
    wins: 1,
    winRatePct: 50,
    avgScore: 15,
    highestScore: 20,
    longestWordPlayed: "CASTS",
    currentWinStreak: 1,
    bestWinStreak: 1,
    lifetimeWordsPlayed: 10,
    lifetimeScore: 30,
    avgGameDurationSec: 600,
    recentGames: [
      {
        gameId: "game-1",
        endedAt: "2026-01-02T00:10:00.000Z",
        placement: 1,
        playerCount: 2,
        score: 20,
      },
    ],
    ...overrides,
  };
}

function renderStatsPage() {
  render(
    <MemoryRouter>
      <StatsPage />
    </MemoryRouter>,
  );
}

describe("StatsPage", () => {
  it("shows loaded stats, including ordinal placement formatting", async () => {
    fetchPlayerStats.mockResolvedValue(sampleStats());

    renderStatsPage();

    expect(await screen.findByText("Your stats")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // games played
    expect(screen.getByText("50%")).toBeInTheDocument(); // win rate
    // Longest word renders both as tiles (one LetterTile per letter) and as
    // plain text, CSS-toggled between them — see StatsPage.module.css.
    expect(screen.getByTestId("longest-word-tiles")).toHaveTextContent("CASTS");
    expect(screen.getByTestId("longest-word-text")).toHaveTextContent("CASTS");
    expect(screen.getByText("1st place")).toBeInTheDocument();
  });

  it("shows an empty state when the player has no completed games", async () => {
    fetchPlayerStats.mockResolvedValue(
      sampleStats({
        gamesPlayed: 0,
        wins: 0,
        winRatePct: null,
        avgScore: null,
        highestScore: null,
        longestWordPlayed: null,
        currentWinStreak: 0,
        bestWinStreak: 0,
        lifetimeScore: 0,
        avgGameDurationSec: null,
        recentGames: [],
      }),
    );

    renderStatsPage();

    expect(
      await screen.findByText("No completed games yet — play a game to see your stats here."),
    ).toBeInTheDocument();
  });

  it("shows an error state when the fetch fails", async () => {
    fetchPlayerStats.mockRejectedValue(new Error("network error"));

    renderStatsPage();

    expect(await screen.findByText("Something went wrong loading your stats.")).toBeInTheDocument();
  });
});
