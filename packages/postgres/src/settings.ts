import type { Kysely } from "kysely";
import type { Database } from "./schema.js";

export interface PlayerSettings {
  language: string;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}

/** Matches the `player_settings` table's own column defaults
 * (docs/postgres-schema.md) — returned as-is by getPlayerSettings when a
 * player has never saved, rather than requiring a row to be provisioned in
 * advance (see docs/decisions.md "player_settings provisioning: lazy
 * upsert"). */
export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  language: "English",
  soundEnabled: true,
  hapticsEnabled: true,
};

export async function getPlayerSettings(
  db: Kysely<Database>,
  clerkUserId: string,
): Promise<PlayerSettings> {
  const row = await db
    .selectFrom("player_settings")
    .where("clerk_user_id", "=", clerkUserId)
    .select(["language", "sound_enabled", "haptics_enabled"])
    .executeTakeFirst();

  if (!row) return DEFAULT_PLAYER_SETTINGS;

  return {
    language: row.language,
    soundEnabled: row.sound_enabled,
    hapticsEnabled: row.haptics_enabled,
  };
}

/** A real upsert (unlike games.ts's `onConflict().doNothing()`) — a repeat
 * save from the same player is expected and should update the row, not be
 * silently dropped. */
export async function upsertPlayerSettings(
  db: Kysely<Database>,
  clerkUserId: string,
  settings: PlayerSettings,
): Promise<void> {
  const updatedAt = new Date();
  await db
    .insertInto("player_settings")
    .values({
      clerk_user_id: clerkUserId,
      language: settings.language,
      sound_enabled: settings.soundEnabled,
      haptics_enabled: settings.hapticsEnabled,
      updated_at: updatedAt,
    })
    .onConflict((oc) =>
      oc.column("clerk_user_id").doUpdateSet({
        language: settings.language,
        sound_enabled: settings.soundEnabled,
        haptics_enabled: settings.hapticsEnabled,
        updated_at: updatedAt,
      }),
    )
    .execute();
}
