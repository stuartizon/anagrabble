import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Loader } from "./Loader";

describe("Loader", () => {
  it("renders one tile per letter of the target word, uppercased, starting face-down", () => {
    render(<Loader word="cat" />);
    const row = within(screen.getByTestId("loader"));

    expect(row.queryByText("C")).not.toBeInTheDocument();
    expect(row.queryByText("A")).not.toBeInTheDocument();
    expect(row.queryByText("T")).not.toBeInTheDocument();
  });

  it("settles tiles left-to-right over time, then loops", () => {
    vi.useFakeTimers();
    try {
      render(<Loader word="CAT" />);
      const row = within(screen.getByTestId("loader"));

      act(() => {
        vi.advanceTimersByTime(240);
      });
      expect(row.getByText("C")).toBeInTheDocument();
      expect(row.queryByText("A")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(480);
      });
      expect(row.getByText("C")).toBeInTheDocument();
      expect(row.getByText("A")).toBeInTheDocument();
      expect(row.getByText("T")).toBeInTheDocument();

      // Holds for a pause once fully settled, then resets to face-down
      // and loops.
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(row.queryByText("C")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
