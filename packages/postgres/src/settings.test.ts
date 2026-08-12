import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { Pool } from "pg";
import { createDb, createPostgresClient } from "./client.js";
import { runMigrations } from "./migrate.js";
import { DEFAULT_PLAYER_SETTINGS, getPlayerSettings, upsertPlayerSettings } from "./settings.js";
import type { Database } from "./schema.js";

describe("settings", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: Kysely<Database>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    pool = createPostgresClient({ connectionString: container.getConnectionUri() });
    db = createDb(pool);
    await runMigrations(db);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await pool.query(
      "truncate table player_settings, game_players, word_plays, games restart identity cascade",
    );
  });

  describe("getPlayerSettings", () => {
    it("returns schema defaults when no row exists yet", async () => {
      expect(await getPlayerSettings(db, "user_1")).toEqual(DEFAULT_PLAYER_SETTINGS);
    });

    it("returns saved values once a row exists", async () => {
      await upsertPlayerSettings(db, "user_1", {
        language: "English",
        soundEnabled: false,
        hapticsEnabled: false,
      });

      expect(await getPlayerSettings(db, "user_1")).toEqual({
        language: "English",
        soundEnabled: false,
        hapticsEnabled: false,
      });
    });

    it("isolates one player's settings from another's", async () => {
      await upsertPlayerSettings(db, "user_1", {
        language: "English",
        soundEnabled: false,
        hapticsEnabled: false,
      });

      expect(await getPlayerSettings(db, "user_2")).toEqual(DEFAULT_PLAYER_SETTINGS);
    });
  });

  describe("upsertPlayerSettings", () => {
    it("updates the existing row on a second save rather than erroring/duplicating", async () => {
      await upsertPlayerSettings(db, "user_1", {
        language: "English",
        soundEnabled: true,
        hapticsEnabled: true,
      });
      await upsertPlayerSettings(db, "user_1", {
        language: "English",
        soundEnabled: false,
        hapticsEnabled: true,
      });

      expect(await getPlayerSettings(db, "user_1")).toEqual({
        language: "English",
        soundEnabled: false,
        hapticsEnabled: true,
      });

      const { rows } = await pool.query(
        "select count(*)::int as count from player_settings where clerk_user_id = $1",
        ["user_1"],
      );
      expect(rows[0].count).toBe(1);
    });
  });
});
