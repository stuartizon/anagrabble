import type { Kysely } from "kysely";
import type { UsedWord } from "@anagrabble/protocol";
import type { Database } from "./schema.js";
import { jsonbValue } from "./jsonb.js";

export interface InsertWordPlayArgs {
  gameId: string;
  seq: number;
  clerkUserId: string;
  word: string;
  usedWords: UsedWord[];
  usedPoolLetters: string[];
}

/** `WordPlayed` accepted -> insert a `word_plays` row
 * (docs/postgres-schema.md's event table). `onConflict(game_id, seq)
 * .doNothing()` makes the async, fire-and-forget write idempotent on retry —
 * `seq` is the Redis seq at the moment of this play, so it's already the
 * natural per-game dedup key. */
export async function insertWordPlay(
  db: Kysely<Database>,
  args: InsertWordPlayArgs,
): Promise<void> {
  await db
    .insertInto("word_plays")
    .values({
      game_id: args.gameId,
      seq: args.seq,
      clerk_user_id: args.clerkUserId,
      word: args.word,
      used_words: jsonbValue(args.usedWords),
      used_pool_letters: args.usedPoolLetters,
    })
    .onConflict((oc) => oc.columns(["game_id", "seq"]).doNothing())
    .execute();
}
