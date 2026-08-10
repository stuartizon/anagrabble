import type * as ReactRouterDom from "react-router-dom";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockSignedOutClerk } from "../testUtils/clerkTestMock";
import { HomePage } from "./HomePage";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@clerk/react", () => mockSignedOutClerk());

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  it("shows the pitch and how-it-works copy to a signed-out visitor", () => {
    renderPage();

    expect(screen.getByText("Turn a letter. Take a word.")).toBeInTheDocument();
    expect(screen.getByText("1. Turn a tile")).toBeInTheDocument();
    expect(screen.getByText("2. Play a word")).toBeInTheDocument();
    expect(screen.getByText("3. Steal a word")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
  });

  it("sends Create a game to the new-game form, leaving the login gate to RequireAuth", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Create a game" }));
    expect(navigateMock).toHaveBeenCalledWith("/new");
  });
});
