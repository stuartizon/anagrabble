import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { Pool } from "pg";
import type { GameConfig } from "@anagrabble/protocol";
import { createDb, createPostgresClient } from "./client.js";
import { runMigrations } from "./migrate.js";
import { insertGame } from "./games.js";
import { insertWordPlay } from "./wordPlays.js";
import type { Database } from "./schema.js";

const CONFIG: GameConfig = { turnTimerSec: 30, minWordLength: 3, language: "en" };

describe("insertWordPlay", () => {
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
    await pool.query("truncate table game_players, word_plays, games restart identity cascade");
    await insertGame(db, { id: "game-1", config: CONFIG, startedAt: new Date("2026-01-01") });
  });

  it("inserts a row for a submitted word", async () => {
    await insertWordPlay(db, {
      gameId: "game-1",
      seq: 4,
      clerkUserId: "user_1",
      word: "CAST",
      usedWords: [{ word: "CAT", ownerId: "user_2" }],
      usedPoolLetters: ["S"],
    });

    const { rows } = await pool.query(
      "select game_id, seq, clerk_user_id, word, used_words, used_pool_letters from word_plays",
    );
    expect(rows).toEqual([
      {
        game_id: "game-1",
        seq: 4,
        clerk_user_id: "user_1",
        word: "CAST",
        used_words: [{ word: "CAT", ownerId: "user_2" }],
        used_pool_letters: ["S"],
      },
    ]);
  });

  it("is idempotent when retried with the same game/seq", async () => {
    const args = {
      gameId: "game-1",
      seq: 4,
      clerkUserId: "user_1",
      word: "CAST",
      usedWords: [],
      usedPoolLetters: ["C", "A", "S", "T"],
    };

    await insertWordPlay(db, args);
    await insertWordPlay(db, args);

    const { rows } = await pool.query("select count(*) from word_plays");
    expect(rows[0].count).toBe("1");
  });

  it("allows the same word claimed independently at a different seq", async () => {
    await insertWordPlay(db, {
      gameId: "game-1",
      seq: 1,
      clerkUserId: "user_1",
      word: "CAT",
      usedWords: [],
      usedPoolLetters: ["C", "A", "T"],
    });
    await insertWordPlay(db, {
      gameId: "game-1",
      seq: 2,
      clerkUserId: "user_2",
      word: "CAT",
      usedWords: [],
      usedPoolLetters: ["C", "A", "T"],
    });

    const { rows } = await pool.query("select count(*) from word_plays");
    expect(rows[0].count).toBe("2");
  });
});
