// Stub player identity — auth is explicitly out of scope for this slice
// (see CLAUDE.md). A stable id + editable display name, persisted locally,
// stands in for a real account until login lands.

const STORAGE_KEY = "anagrabble_player";

export interface PlayerIdentity {
  id: string;
  name: string;
}

function randomName(): string {
  return `Player ${Math.floor(1000 + Math.random() * 9000)}`;
}

function generateId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getPlayerIdentity(): PlayerIdentity {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PlayerIdentity;
      if (parsed.id && parsed.name) return parsed;
    } catch {
      // fall through to regenerate
    }
  }
  const identity: PlayerIdentity = { id: generateId(), name: randomName() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function setPlayerName(name: string): PlayerIdentity {
  const identity = { ...getPlayerIdentity(), name };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}
