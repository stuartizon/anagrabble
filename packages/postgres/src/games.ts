import type { Kysely } from "kysely";
import type { GameConfig } from "@anagrabble/protocol";
import type { Database } from "./schema.js";
import { jsonbValue } from "./jsonb.js";

/** Async, after Redis, never on the critical path of a move — see
 * docs/postgres-schema.md "Writes are async, after Redis". */
export interface InsertGameArgs {
  id: string;
  config: GameConfig;
  startedAt: Date;
}

/** `StartGame` accepted -> insert a `games` row (docs/postgres-schema.md's
 * event table). `onConflict().doNothing()` since this is a fire-and-forget
 * write that may be retried. */
export async function insertGame(db: Kysely<Database>, args: InsertGameArgs): Promise<void> {
  await db
    .insertInto("games")
    .values({
      id: args.id,
      config: jsonbValue(args.config),
      started_at: args.startedAt,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

export interface EndGamePlayer {
  clerkUserId: string;
  name: string;
  playerIndex: number;
  finalScore: number;
  finalWords: string[];
}

export interface EndGameArgs {
  gameId: string;
  endedAt: Date;
  players: EndGamePlayer[];
}

/** `GameEnded` accepted -> update `games.ended_at` and insert final
 * `game_players` rows (docs/postgres-schema.md's event table). Both writes
 * share a transaction so a retry never observes `ended_at` set without the
 * player rows, or vice versa. */
export async function endGame(db: Kysely<Database>, args: EndGameArgs): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("games")
      .set({ ended_at: args.endedAt })
      .where("id", "=", args.gameId)
      .where("ended_at", "is", null)
      .execute();

    if (args.players.length === 0) return;

    await trx
      .insertInto("game_players")
      .values(
        args.players.map((player) => ({
          game_id: args.gameId,
          clerk_user_id: player.clerkUserId,
          name: player.name,
          player_index: player.playerIndex,
          final_score: player.finalScore,
          final_words: player.finalWords,
        })),
      )
      .onConflict((oc) => oc.columns(["game_id", "clerk_user_id"]).doNothing())
      .execute();
  });
}
