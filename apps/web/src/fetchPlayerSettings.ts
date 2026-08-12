import type { PlayerSettingsResponse } from "@anagrabble/protocol";

export type { PlayerSettingsResponse };

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) throw new Error("VITE_API_URL is not set");

export async function fetchPlayerSettings(token: string): Promise<PlayerSettingsResponse> {
  const res = await fetch(`${API_URL}/settings`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
  return res.json();
}

export async function savePlayerSettings(
  token: string,
  settings: PlayerSettingsResponse,
): Promise<PlayerSettingsResponse> {
  const res = await fetch(`${API_URL}/settings`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Failed to save settings (${res.status})`);
  return res.json();
}
