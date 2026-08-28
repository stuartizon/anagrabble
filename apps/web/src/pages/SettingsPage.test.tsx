import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mockSignedInClerk } from "../testUtils/clerkTestMock";
import type { PlayerSettingsResponse } from "../client/fetchPlayerSettings";

vi.mock("../auth", () => mockSignedInClerk());

const fetchPlayerSettings = vi.fn();
const savePlayerSettings = vi.fn();
vi.mock("../client/fetchPlayerSettings", () => ({
  fetchPlayerSettings: (...args: unknown[]) => fetchPlayerSettings(...args),
  savePlayerSettings: (...args: unknown[]) => savePlayerSettings(...args),
}));

const { SettingsPage } = await import("./SettingsPage");

function sampleSettings(overrides: Partial<PlayerSettingsResponse> = {}): PlayerSettingsResponse {
  return { language: "English", soundEnabled: true, hapticsEnabled: true, ...overrides };
}

function renderSettingsPage() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsPage", () => {
  it("shows the loaded settings", async () => {
    fetchPlayerSettings.mockResolvedValue(sampleSettings());

    renderSettingsPage();

    expect(await screen.findByText("Settings")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Sound effects" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Haptic feedback" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows an error state when the fetch fails", async () => {
    fetchPlayerSettings.mockRejectedValue(new Error("network error"));

    renderSettingsPage();

    expect(
      await screen.findByText("Something went wrong loading your settings."),
    ).toBeInTheDocument();
  });

  it("toggling sound saves immediately and updates the switch", async () => {
    fetchPlayerSettings.mockResolvedValue(sampleSettings({ soundEnabled: true }));
    savePlayerSettings.mockResolvedValue(sampleSettings({ soundEnabled: false }));
    const user = userEvent.setup();

    renderSettingsPage();
    const soundSwitch = await screen.findByRole("switch", { name: "Sound effects" });
    await user.click(soundSwitch);

    expect(savePlayerSettings).toHaveBeenCalledWith("test-token", {
      language: "English",
      soundEnabled: false,
      hapticsEnabled: true,
    });
    await waitFor(() => expect(soundSwitch).toHaveAttribute("aria-checked", "false"));
  });

  it("toggling haptics saves immediately and updates the switch", async () => {
    fetchPlayerSettings.mockResolvedValue(sampleSettings({ hapticsEnabled: true }));
    savePlayerSettings.mockResolvedValue(sampleSettings({ hapticsEnabled: false }));
    const user = userEvent.setup();

    renderSettingsPage();
    const hapticsSwitch = await screen.findByRole("switch", { name: "Haptic feedback" });
    await user.click(hapticsSwitch);

    expect(savePlayerSettings).toHaveBeenCalledWith("test-token", {
      language: "English",
      soundEnabled: true,
      hapticsEnabled: false,
    });
    await waitFor(() => expect(hapticsSwitch).toHaveAttribute("aria-checked", "false"));
  });

  it("reverts the toggle and shows an error when the save fails", async () => {
    fetchPlayerSettings.mockResolvedValue(sampleSettings({ soundEnabled: true }));
    savePlayerSettings.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();

    renderSettingsPage();
    const soundSwitch = await screen.findByRole("switch", { name: "Sound effects" });
    await user.click(soundSwitch);

    expect(await screen.findByText("Couldn't save your changes.")).toBeInTheDocument();
    await waitFor(() => expect(soundSwitch).toHaveAttribute("aria-checked", "true"));
  });
});
