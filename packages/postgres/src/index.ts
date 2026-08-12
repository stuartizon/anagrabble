export { createPostgresClient, createDb, type CreatePostgresClientOptions } from "./client.js";
export type { Pool } from "pg";
export type { Kysely } from "kysely";
export type { Database } from "./schema.js";
export { runMigrations } from "./migrate.js";
export {
  insertGame,
  endGame,
  type InsertGameArgs,
  type EndGameArgs,
  type EndGamePlayer,
} from "./games.js";
export { insertWordPlay, type InsertWordPlayArgs } from "./wordPlays.js";
export {
  getCompletedGamesForPlayer,
  getLongestWordPlayed,
  getLifetimeWordsPlayed,
  getPlayerStats,
  type CompletedGameForPlayer,
  type PlayerStats,
  type GetPlayerStatsOptions,
} from "./stats.js";
export {
  getPlayerSettings,
  upsertPlayerSettings,
  DEFAULT_PLAYER_SETTINGS,
  type PlayerSettings,
} from "./settings.js";
