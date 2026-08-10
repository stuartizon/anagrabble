import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { Pool } from "pg";
import type { GameConfig } from "@anagrabble/protocol";
import { createDb, createPostgresClient } from "./client.js";
import { runMigrations } from "./migrate.js";
import { endGame, insertGame } from "./games.js";
import type { Database } from "./schema.js";

const CONFIG: GameConfig = { turnTimerSec: 30, minWordLength: 3, language: "en" };

describe("games", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: Kysely<Database>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    pool = createPostgresClient({ connectionString: container.getConnectionUri() });
    db = createDb(pool);
    await runMigrations(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await pool.query("truncate table game_players, word_plays, games restart identity cascade");
  });

  describe("insertGame", () => {
    it("inserts a row for a newly started game", async () => {
      await insertGame(db, { id: "game-1", config: CONFIG, startedAt: new Date("2026-01-01") });

      const { rows } = await pool.query("select id, config, started_at, ended_at from games");
      expect(rows).toEqual([
        {
          id: "game-1",
          config: CONFIG,
          started_at: new Date("2026-01-01"),
          ended_at: null,
        },
      ]);
    });

    it("is idempotent when retried with the same id", async () => {
      await insertGame(db, { id: "game-1", config: CONFIG, startedAt: new Date("2026-01-01") });
      await insertGame(db, { id: "game-1", config: CONFIG, startedAt: new Date("2026-01-01") });

      const { rows } = await pool.query("select count(*) from games");
      expect(rows[0].count).toBe("1");
    });
  });

  describe("endGame", () => {
    beforeEach(async () => {
      await insertGame(db, { id: "game-1", config: CONFIG, startedAt: new Date("2026-01-01") });
    });

    it("sets ended_at and inserts final game_players rows", async () => {
      const endedAt = new Date("2026-01-01T00:10:00Z");
      await endGame(db, {
        gameId: "game-1",
        endedAt,
        players: [
          {
            clerkUserId: "user_1",
            name: "One",
            playerIndex: 0,
            finalScore: 12,
            finalWords: ["CAT", "CATS"],
          },
          {
            clerkUserId: "user_2",
            name: "Two",
            playerIndex: 1,
            finalScore: 5,
            finalWords: ["DOG"],
          },
        ],
      });

      const game = await pool.query("select ended_at from games where id = $1", ["game-1"]);
      expect(game.rows[0].ended_at).toEqual(endedAt);

      const players = await pool.query(
        "select clerk_user_id, name, player_index, final_score, final_words from game_players order by player_index",
      );
      expect(players.rows).toEqual([
        {
          clerk_user_id: "user_1",
          name: "One",
          player_index: 0,
          final_score: 12,
          final_words: ["CAT", "CATS"],
        },
        {
          clerk_user_id: "user_2",
          name: "Two",
          player_index: 1,
          final_score: 5,
          final_words: ["DOG"],
        },
      ]);
    });

    it("is idempotent when retried", async () => {
      const endedAt = new Date("2026-01-01T00:10:00Z");
      const args = {
        gameId: "game-1",
        endedAt,
        players: [
          {
            clerkUserId: "user_1",
            name: "One",
            playerIndex: 0,
            finalScore: 12,
            finalWords: ["CAT"],
          },
        ],
      };

      await endGame(db, args);
      await endGame(db, args);

      const players = await pool.query("select count(*) from game_players");
      expect(players.rows[0].count).toBe("1");
    });
  });
});
