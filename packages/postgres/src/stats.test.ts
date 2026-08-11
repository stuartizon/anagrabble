import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { Pool } from "pg";
import type { GameConfig } from "@anagrabble/protocol";
import { createDb, createPostgresClient } from "./client.js";
import { runMigrations } from "./migrate.js";
import { endGame, insertGame, type EndGamePlayer } from "./games.js";
import { insertWordPlay } from "./wordPlays.js";
import {
  getCompletedGamesForPlayer,
  getLifetimeWordsPlayed,
  getLongestWordPlayed,
  getPlayerStats,
} from "./stats.js";
import type { Database } from "./schema.js";

const CONFIG: GameConfig = { turnTimerSec: 30, minWordLength: 3, language: "en" };

describe("stats", () => {
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
  });

  async function seedCompletedGame(args: {
    id: string;
    startedAt: Date;
    endedAt: Date;
    players: EndGamePlayer[];
  }): Promise<void> {
    await insertGame(db, { id: args.id, config: CONFIG, startedAt: args.startedAt });
    await endGame(db, { gameId: args.id, endedAt: args.endedAt, players: args.players });
  }

  function player(clerkUserId: string, playerIndex: number, finalScore: number): EndGamePlayer {
    return { clerkUserId, name: clerkUserId, playerIndex, finalScore, finalWords: [] };
  }

  describe("getCompletedGamesForPlayer", () => {
    it("uses competition-style ranking so a tie at the top shares placement 1, not 1/2", async () => {
      await seedCompletedGame({
        id: "game-1",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T00:10:00Z"),
        players: [player("user_1", 0, 10), player("user_2", 1, 10), player("user_3", 2, 5)],
      });

      const [mine] = await getCompletedGamesForPlayer(db, "user_1");
      expect(mine.placement).toBe(1);
      expect(mine.isWin).toBe(true);
      expect(mine.playerCount).toBe(3);

      const [theirs] = await getCompletedGamesForPlayer(db, "user_3");
      expect(theirs.placement).toBe(3);
      expect(theirs.isWin).toBe(false);
    });

    it("excludes games that were started but never ended", async () => {
      await seedCompletedGame({
        id: "game-completed",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T00:10:00Z"),
        players: [player("user_1", 0, 10)],
      });
      await insertGame(db, {
        id: "game-abandoned",
        config: CONFIG,
        startedAt: new Date("2026-01-02T00:00:00Z"),
      });

      const games = await getCompletedGamesForPlayer(db, "user_1");
      expect(games.map((g) => g.gameId)).toEqual(["game-completed"]);
    });

    it("orders most-recent-first", async () => {
      for (const [id, day] of [
        ["game-1", "01"],
        ["game-2", "02"],
        ["game-3", "03"],
      ] as const) {
        await seedCompletedGame({
          id,
          startedAt: new Date(`2026-01-${day}T00:00:00Z`),
          endedAt: new Date(`2026-01-${day}T00:10:00Z`),
          players: [player("user_1", 0, 10)],
        });
      }

      const games = await getCompletedGamesForPlayer(db, "user_1");
      expect(games.map((g) => g.gameId)).toEqual(["game-3", "game-2", "game-1"]);
    });
  });

  describe("getLongestWordPlayed", () => {
    it("returns the longest word across all games, including abandoned ones", async () => {
      await insertGame(db, { id: "game-1", config: CONFIG, startedAt: new Date("2026-01-01") });
      await insertGame(db, { id: "game-2", config: CONFIG, startedAt: new Date("2026-01-02") });
      await insertWordPlay(db, {
        gameId: "game-1",
        seq: 1,
        clerkUserId: "user_1",
        word: "CAT",
        usedWords: [],
        usedPoolLetters: ["C", "A", "T"],
      });
      // game-2 is never ended (abandoned) — its word play should still count.
      await insertWordPlay(db, {
        gameId: "game-2",
        seq: 1,
        clerkUserId: "user_1",
        word: "FORECASTS",
        usedWords: [],
        usedPoolLetters: ["F", "O", "R", "E", "C", "A", "S", "T", "S"],
      });

      expect(await getLongestWordPlayed(db, "user_1")).toBe("FORECASTS");
    });

    it("returns null for a player with no word plays", async () => {
      expect(await getLongestWordPlayed(db, "user_1")).toBeNull();
    });
  });

  describe("getLifetimeWordsPlayed", () => {
    it("counts word plays across all games, including abandoned ones", async () => {
      await insertGame(db, { id: "game-1", config: CONFIG, startedAt: new Date("2026-01-01") });
      await insertGame(db, { id: "game-2", config: CONFIG, startedAt: new Date("2026-01-02") });
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
        clerkUserId: "user_1",
        word: "CATS",
        usedWords: [],
        usedPoolLetters: ["S"],
      });
      // Abandoned game — still counts toward lifetime words played.
      await insertWordPlay(db, {
        gameId: "game-2",
        seq: 1,
        clerkUserId: "user_1",
        word: "DOG",
        usedWords: [],
        usedPoolLetters: ["D", "O", "G"],
      });
      // A different player's word play must not count toward user_1's total.
      await insertWordPlay(db, {
        gameId: "game-1",
        seq: 3,
        clerkUserId: "user_2",
        word: "BAT",
        usedWords: [],
        usedPoolLetters: ["B", "A", "T"],
      });

      expect(await getLifetimeWordsPlayed(db, "user_1")).toBe(3);
    });
  });

  describe("getPlayerStats", () => {
    it("returns a zeroed/null-filled result for a player with no completed games", async () => {
      const stats = await getPlayerStats(db, "user_1");
      expect(stats).toEqual({
        gamesPlayed: 0,
        wins: 0,
        winRatePct: null,
        avgScore: null,
        highestScore: null,
        longestWordPlayed: null,
        currentWinStreak: 0,
        bestWinStreak: 0,
        lifetimeWordsPlayed: 0,
        lifetimeScore: 0,
        avgGameDurationSec: null,
        recentGames: [],
      });
    });

    it("computes win rate, avg/highest score, and lifetime score from completed games only", async () => {
      await seedCompletedGame({
        id: "game-1",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T00:05:00Z"), // 5 min
        players: [player("user_1", 0, 20), player("user_2", 1, 5)],
      });
      await seedCompletedGame({
        id: "game-2",
        startedAt: new Date("2026-01-02T00:00:00Z"),
        endedAt: new Date("2026-01-02T00:15:00Z"), // 15 min
        players: [player("user_1", 0, 10), player("user_2", 1, 15)],
      });
      // Abandoned game with a real word play — must not affect score-based
      // figures (no final_score exists for it), but must count toward
      // lifetimeWordsPlayed/longestWordPlayed.
      await insertGame(db, { id: "game-3", config: CONFIG, startedAt: new Date("2026-01-03") });
      await insertWordPlay(db, {
        gameId: "game-3",
        seq: 1,
        clerkUserId: "user_1",
        word: "ABANDONEDGAME",
        usedWords: [],
        usedPoolLetters: [],
      });

      const stats = await getPlayerStats(db, "user_1");
      expect(stats.gamesPlayed).toBe(2);
      expect(stats.wins).toBe(1);
      expect(stats.winRatePct).toBe(50);
      expect(stats.avgScore).toBe(15); // (20 + 10) / 2
      expect(stats.highestScore).toBe(20);
      expect(stats.lifetimeScore).toBe(30); // 20 + 10, completed games only
      expect(stats.avgGameDurationSec).toBe(600); // (300 + 900) / 2
      expect(stats.longestWordPlayed).toBe("ABANDONEDGAME");
      expect(stats.lifetimeWordsPlayed).toBe(1);
    });

    it("computes current and best win streaks from an ordered sequence of results", async () => {
      // Chronological (oldest -> newest): win, win, win, loss, win, win.
      const results = [true, true, true, false, true, true];
      for (const [i, isWin] of results.entries()) {
        await seedCompletedGame({
          id: `game-${i}`,
          startedAt: new Date(`2026-01-0${i + 1}T00:00:00Z`),
          endedAt: new Date(`2026-01-0${i + 1}T00:10:00Z`),
          players: [player("user_1", 0, isWin ? 10 : 5), player("user_2", 1, isWin ? 5 : 10)],
        });
      }

      const stats = await getPlayerStats(db, "user_1");
      expect(stats.bestWinStreak).toBe(3);
      expect(stats.currentWinStreak).toBe(2);
    });

    it("isolates one player's stats from another's", async () => {
      await seedCompletedGame({
        id: "game-1",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T00:10:00Z"),
        players: [player("user_1", 0, 20), player("user_2", 1, 5)],
      });

      const mine = await getPlayerStats(db, "user_1");
      const theirs = await getPlayerStats(db, "user_2");
      expect(mine.wins).toBe(1);
      expect(mine.highestScore).toBe(20);
      expect(theirs.wins).toBe(0);
      expect(theirs.highestScore).toBe(5);
    });

    it("respects recentGamesLimit, most-recent-first", async () => {
      for (let i = 1; i <= 5; i += 1) {
        await seedCompletedGame({
          id: `game-${i}`,
          startedAt: new Date(`2026-01-0${i}T00:00:00Z`),
          endedAt: new Date(`2026-01-0${i}T00:10:00Z`),
          players: [player("user_1", 0, 10)],
        });
      }

      const stats = await getPlayerStats(db, "user_1", { recentGamesLimit: 3 });
      expect(stats.gamesPlayed).toBe(5); // unaffected by the slice
      expect(stats.recentGames.map((g) => g.gameId)).toEqual(["game-5", "game-4", "game-3"]);
    });
  });
});
