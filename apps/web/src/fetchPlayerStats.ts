import type { PlayerStatsResponse } from "@anagrabble/protocol";

export type { PlayerStatsResponse };

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) throw new Error("VITE_API_URL is not set");

export async function fetchPlayerStats(token: string): Promise<PlayerStatsResponse> {
  const res = await fetch(`${API_URL}/stats`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
  return res.json();
}
