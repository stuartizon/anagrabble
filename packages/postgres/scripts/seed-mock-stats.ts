// Populates completed games/word plays for the local VITE_AUTH_MODE=mock /
// AUTH_MODE=mock roster (apps/web/src/auth/mockUsers.ts) so /stats has
// something to show against a fresh local Postgres — the mock roster exists
// but nothing ever plays through it outside a manual multi-tab session.
// Idempotent: game ids are fixed, and insertGame/endGame/insertWordPlay all
// onConflict().doNothing(), so re-running this just no-ops. Dev-only, never
// run against a deployed database (there's no mock user roster there to
// attach the data to).
//
// Usage: pnpm --filter @anagrabble/postgres seed:mock
import type { Kysely } from "kysely";
import type { GameConfig } from "@anagrabble/protocol";
import {
  createDb,
  createPostgresClient,
  runMigrations,
  insertGame,
  endGame,
  insertWordPlay,
  type Database,
} from "../src/index.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://anagrabble:anagrabble@localhost:5432/anagrabble";

// Mirrors packages/game's DEFAULT_GAME_CONFIG (not imported, to avoid adding
// a workspace dependency just for one literal) — keep in sync if that
// default ever changes.
const GAME_CONFIG: GameConfig = { turnTimerSec: 30, minWordLength: 3, language: "en" };

// Same formula as packages/redis/src/scripts/apply_submit_word.lua
// ("score = score + 1 + (#w - minWordLength)"), applied here so seeded
// final_score always matches the seeded word list instead of being an
// arbitrary number that happens to disagree with final_words.
function wordScore(word: string): number {
  return 1 + (word.length - GAME_CONFIG.minWordLength);
}

interface SeedPlayer {
  clerkUserId: string;
  name: string;
  words: string[];
}

interface SeedGame {
  id: string;
  startedAt: Date;
  endedAt: Date;
  players: SeedPlayer[];
}

const ALICE = "mock-alice";
const BOB = "mock-bob";
const CHARLIE = "mock-charlie";
// mock-diana is deliberately never used below — leaving one mock user with
// zero games exercises the stats page's empty state locally.

const GAMES: SeedGame[] = [
  {
    id: "mock-seed-game-1",
    startedAt: new Date("2026-07-20T18:00:00Z"),
    endedAt: new Date("2026-07-20T18:23:00Z"),
    players: [
      {
        clerkUserId: ALICE,
        name: "Alice",
        words: ["CAT", "CATS", "STAR", "STARE", "TARTS", "PARTS"],
      },
      { clerkUserId: BOB, name: "Bob", words: ["DOG", "DOGS", "GOLD", "GOLDS", "LODGES"] },
    ],
  },
  {
    id: "mock-seed-game-2",
    startedAt: new Date("2026-07-24T19:00:00Z"),
    endedAt: new Date("2026-07-24T19:31:00Z"),
    players: [
      {
        clerkUserId: BOB,
        name: "Bob",
        words: ["RAIN", "RAINS", "BRAIN", "BRAINY", "TRAINS", "STRAIN"],
      },
      { clerkUserId: ALICE, name: "Alice", words: ["SUN", "SUNS", "NUTS", "STUN", "STUNS"] },
      { clerkUserId: CHARLIE, name: "Charlie", words: ["ICE", "DICE", "SPICE"] },
    ],
  },
  {
    id: "mock-seed-game-3",
    startedAt: new Date("2026-07-29T17:15:00Z"),
    endedAt: new Date("2026-07-29T17:50:00Z"),
    players: [
      { clerkUserId: ALICE, name: "Alice", words: ["TIDE", "TIDES", "EDIT", "EDITS"] },
      {
        clerkUserId: CHARLIE,
        name: "Charlie",
        words: ["MOON", "MOONS", "SALMON", "ALMOND", "ALMONDS"],
      },
    ],
  },
  {
    id: "mock-seed-game-4",
    startedAt: new Date("2026-08-02T20:00:00Z"),
    endedAt: new Date("2026-08-02T20:41:00Z"),
    players: [
      { clerkUserId: BOB, name: "Bob", words: ["WORD", "WORDS", "SWORD", "SWORDS"] },
      { clerkUserId: CHARLIE, name: "Charlie", words: ["LEMON", "MELON", "LEMONS", "MELONS"] },
      {
        clerkUserId: ALICE,
        name: "Alice",
        words: ["GRABBLE", "ANAGRAM", "GAMER", "GAMERS", "GRAB", "CRAB"],
      },
    ],
  },
  {
    id: "mock-seed-game-5",
    startedAt: new Date("2026-08-06T18:30:00Z"),
    endedAt: new Date("2026-08-06T18:44:00Z"),
    players: [
      { clerkUserId: ALICE, name: "Alice", words: ["FOX", "FOXES", "OXEN", "VIXEN"] },
      { clerkUserId: BOB, name: "Bob", words: ["WOLF", "WOLVES"] },
    ],
  },
  {
    id: "mock-seed-game-6",
    startedAt: new Date("2026-08-09T21:00:00Z"),
    endedAt: new Date("2026-08-09T21:36:00Z"),
    players: [
      { clerkUserId: BOB, name: "Bob", words: ["PLANET", "PLANETS", "PLANE", "PLANES"] },
      { clerkUserId: CHARLIE, name: "Charlie", words: ["STONE", "STONES", "TONES", "NOTES"] },
    ],
  },
];

async function seedGame(db: Kysely<Database>, game: SeedGame): Promise<void> {
  await insertGame(db, { id: game.id, config: GAME_CONFIG, startedAt: game.startedAt });

  await endGame(db, {
    gameId: game.id,
    endedAt: game.endedAt,
    players: game.players.map((player, playerIndex) => ({
      clerkUserId: player.clerkUserId,
      name: player.name,
      playerIndex,
      finalScore: player.words.reduce((sum, word) => sum + wordScore(word), 0),
      finalWords: player.words,
    })),
  });

  // Interleave each player's plays in claim order so seq is a plausible
  // single monotonic timeline across the whole game, same as the real
  // Redis seq word_plays rows are keyed on.
  let seq = 1;
  const maxWords = Math.max(...game.players.map((player) => player.words.length));
  for (let round = 0; round < maxWords; round++) {
    for (const player of game.players) {
      const word = player.words[round];
      if (!word) continue;
      await insertWordPlay(db, {
        gameId: game.id,
        seq: seq++,
        clerkUserId: player.clerkUserId,
        word,
        usedWords: [],
        usedPoolLetters: word.split(""),
      });
    }
  }
}

async function main(): Promise<void> {
  const pool = createPostgresClient({ connectionString: DATABASE_URL });
  const db = createDb(pool);

  try {
    await runMigrations(db);
    for (const game of GAMES) {
      await seedGame(db, game);
    }
    console.log(`Seeded ${GAMES.length} mock games for ${ALICE}, ${BOB}, ${CHARLIE}.`);
    console.log("mock-diana intentionally has none — use it to check the empty stats state.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
