import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RulesLink } from "./RulesLink";

describe("RulesLink", () => {
  it("is closed until clicked, then opens a modal with the rules content", async () => {
    render(<RulesLink />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Review the rules" }));

    expect(screen.getByRole("dialog", { name: "Rules" })).toBeInTheDocument();
    expect(screen.getByText("The basics")).toBeInTheDocument();
  });

  it("closes on the close button", async () => {
    render(<RulesLink />);
    await userEvent.click(screen.getByRole("button", { name: "Review the rules" }));

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on an overlay click but not on a click inside the panel", async () => {
    render(<RulesLink />);
    await userEvent.click(screen.getByRole("button", { name: "Review the rules" }));

    await userEvent.click(screen.getByText("The basics"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
