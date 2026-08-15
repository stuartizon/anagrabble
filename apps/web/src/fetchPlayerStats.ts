import type { PlayerStatsResponse } from "@anagrabble/protocol";
import { API_URL } from "./env";

export type { PlayerStatsResponse };

export async function fetchPlayerStats(token: string): Promise<PlayerStatsResponse> {
  const res = await fetch(`${API_URL}/stats`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
  return res.json();
}
