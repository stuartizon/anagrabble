// The regression this exists to prevent: a component throwing during render
// used to unmount the whole tree and leave a blank page with nothing
// reported anywhere (anagrabble#46). ./sentry is mocked so these assert the
// boundary's own contract, not the vendor SDK's.

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
  initObservability: vi.fn(),
  identifyUser: vi.fn(),
  resetObservabilityForTests: vi.fn(),
}));
vi.mock("./sentry", () => observability);

import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("render exploded");
}

// No router and no auth provider on purpose: the fallback has to render
// standing alone, since it sits outside both in main.tsx.
function renderBoundary(children: ReactNode) {
  return render(<ErrorBoundary>{children}</ErrorBoundary>);
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    observability.reportError.mockClear();
    // React logs the caught error itself; silence it so a passing run isn't
    // full of red noise.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders its children when nothing throws", () => {
    renderBoundary(<div>all fine</div>);
    expect(screen.getByText("all fine")).toBeInTheDocument();
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("shows the fallback instead of a blank page when a child throws", () => {
    renderBoundary(<Boom />);
    expect(screen.getByText("Something broke")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeInTheDocument();
  });

  it("reports the caught error with the component stack", () => {
    renderBoundary(<Boom />);
    expect(observability.reportError).toHaveBeenCalled();
    const [err, context] = observability.reportError.mock.calls[0];
    expect((err as Error).message).toBe("render exploded");
    expect(context.tags).toMatchObject({ op: "react.render" });
    expect(context.extra.componentStack).toBeTruthy();
  });
});
