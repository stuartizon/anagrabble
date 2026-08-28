import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockSignedOutClerk } from "../testUtils/clerkTestMock";
import { RulesPage } from "./RulesPage";

vi.mock("../auth", () => mockSignedOutClerk());

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RulesPage />
    </MemoryRouter>,
  );
}

describe("RulesPage", () => {
  it("shows the full rules text to a signed-out visitor", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Rules" })).toBeInTheDocument();
    expect(screen.getByText("The basics")).toBeInTheDocument();
    expect(screen.getByText("Playing a word")).toBeInTheDocument();
    expect(screen.getByText("Stealing a word")).toBeInTheDocument();
    expect(screen.getByText("Scoring")).toBeInTheDocument();
    expect(screen.getByText("Turns and timing")).toBeInTheDocument();
    expect(screen.getByText("Combining words")).toBeInTheDocument();
    expect(screen.getByText(/CAT → CAST is a valid steal/)).toBeInTheDocument();
  });
});
