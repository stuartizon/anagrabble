import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LetterTile } from "./LetterTile";

describe("LetterTile", () => {
  it("shows the letter face-up by default", () => {
    render(<LetterTile letter="C" />);

    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("hides the letter when face-down", () => {
    render(<LetterTile letter="C" state="down" />);

    expect(screen.queryByText("C")).not.toBeInTheDocument();
  });
});
