import type { ColumnType, Generated } from "kysely";
import type { GameConfig, UsedWord } from "@anagrabble/protocol";

/** Kysely's type-level mirror of src/migrations/*.sql — kept in sync by
 * hand, same discipline as any other schema change (see docs/decisions.md
 * "packages/postgres: Kysely for queries, hand-rolled SQL for migrations").
 * `ColumnType<Select, Insert, Update>` marks columns where the DB default
 * makes the insert-time type optional or absent entirely. */
export interface Database {
  games: GamesTable;
  game_players: GamePlayersTable;
  word_plays: WordPlaysTable;
  player_settings: PlayerSettingsTable;
}

export interface GamesTable {
  id: string;
  config: GameConfig;
  started_at: ColumnType<Date, Date | undefined, never>;
  ended_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, never, never>;
}

export interface GamePlayersTable {
  game_id: string;
  clerk_user_id: string;
  name: string;
  player_index: number;
  final_score: number;
  final_words: string[];
}

export interface WordPlaysTable {
  id: Generated<number>;
  game_id: string;
  seq: number;
  clerk_user_id: string;
  word: string;
  used_words: UsedWord[];
  used_pool_letters: string[];
  created_at: ColumnType<Date, never, never>;
}

export interface PlayerSettingsTable {
  clerk_user_id: string;
  language: ColumnType<string, string | undefined, string>;
  sound_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  haptics_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}
