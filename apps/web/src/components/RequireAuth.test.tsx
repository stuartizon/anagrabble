import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "./RequireAuth";

let isLoaded = true;
let isSignedIn = false;

vi.mock("@clerk/react", () => ({
  Show: ({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) =>
    (when === "signed-in") === isSignedIn ? <>{children}</> : null,
  useUser: () => ({ isLoaded, isSignedIn, user: null }),
  useClerk: () => ({ signOut: vi.fn() }),
  useAuth: () => ({ isLoaded, isSignedIn }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          path="/protected"
          element={
            <RequireAuth>
              <div>Protected content</div>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  isLoaded = true;
  isSignedIn = false;
});

describe("RequireAuth", () => {
  it("redirects to /login when signed out", () => {
    renderAt("/protected");

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders children when signed in", () => {
    isSignedIn = true;
    renderAt("/protected");

    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("renders neither children nor a redirect while auth is still loading", () => {
    isLoaded = false;
    renderAt("/protected");

    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });
});
