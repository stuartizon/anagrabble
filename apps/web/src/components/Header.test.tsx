import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "./Header";

const signOutMock = vi.fn();
let isSignedIn = false;
let user: {
  firstName?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
} | null = null;

vi.mock("../auth", () => ({
  Show: ({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) =>
    (when === "signed-in") === isSignedIn ? <>{children}</> : null,
  useUser: () => ({ isLoaded: true, isSignedIn, user }),
  useClerk: () => ({ signOut: signOutMock }),
}));

function renderHeader(children?: ReactNode) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Header>{children}</Header>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  isSignedIn = false;
  user = null;
  signOutMock.mockReset();
});

describe("Header account status", () => {
  it("shows a Log in link when signed out", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
  });

  it("renders custom children instead of the account status when provided", () => {
    isSignedIn = true;
    user = {
      firstName: "Alex",
      primaryEmailAddress: { emailAddress: "alex@example.com" },
    };
    renderHeader(<span>Bank count</span>);

    expect(screen.getByText("Bank count")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("shows an avatar with the display name's initial when signed in", () => {
    isSignedIn = true;
    user = {
      firstName: "Alex",
      primaryEmailAddress: { emailAddress: "alex@example.com" },
    };
    renderHeader();

    expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("A");
  });

  it("falls back to the email's initial when there's no first name", () => {
    isSignedIn = true;
    user = { firstName: null, primaryEmailAddress: { emailAddress: "sam@example.com" } };
    renderHeader();

    expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("S");
  });

  it("opens the menu on click, shows the name/email, and logs out", async () => {
    isSignedIn = true;
    user = {
      firstName: "Alex",
      primaryEmailAddress: { emailAddress: "alex@example.com" },
    };
    renderHeader();

    expect(screen.queryByText("Alex")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stats" })).toHaveAttribute("href", "/stats");

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(signOutMock).toHaveBeenCalled();
  });

  it("closes the menu when clicking outside", async () => {
    isSignedIn = true;
    user = {
      firstName: "Alex",
      primaryEmailAddress: { emailAddress: "alex@example.com" },
    };
    renderHeader();

    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("Alex")).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
  });
});
