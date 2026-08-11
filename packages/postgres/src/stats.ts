import type { Kysely } from "kysely";
import type { Database } from "./schema.js";

export interface CompletedGameForPlayer {
  gameId: string;
  startedAt: Date;
  endedAt: Date;
  finalScore: number;
  playerCount: number;
  /** 1-based competition ranking (a tie at the top shares placement 1, the
   * next distinct score is placement 3 for a 3-way tie, not 2 — matches
   * apps/web's GameOverSummary `rankPlayers()` tie semantics). */
  placement: number;
  isWin: boolean; // placement === 1
}

/** A game_players row only exists once `GameEnded` is accepted
 * (docs/postgres-schema.md), so a game a player started but never finished
 * has no row here at all — "completed games" falls out of the join by
 * construction, no `ended_at is not null` filter to get wrong. Fetches
 * every player's score per game (not just the target player's) in one
 * query so placement/playerCount can be derived in JS rather than fighting
 * a correlated SQL subquery — consistent with getPlayerStats deriving its
 * other figures in JS from one fetched array. */
export async function getCompletedGamesForPlayer(
  db: Kysely<Database>,
  clerkUserId: string,
): Promise<CompletedGameForPlayer[]> {
  const rows = await db
    .selectFrom("games as g")
    .innerJoin("game_players as mine", (join) =>
      join.onRef("mine.game_id", "=", "g.id").on("mine.clerk_user_id", "=", clerkUserId),
    )
    .innerJoin("game_players as roster", "roster.game_id", "g.id")
    .where("g.ended_at", "is not", null)
    .select([
      "g.id as gameId",
      "g.started_at as startedAt",
      "g.ended_at as endedAt",
      "roster.clerk_user_id as rosterClerkUserId",
      "roster.final_score as rosterFinalScore",
    ])
    .execute();

  interface GameAccumulator {
    startedAt: Date;
    endedAt: Date;
    scores: number[];
    myScore: number;
  }

  const byGame = new Map<string, GameAccumulator>();
  for (const row of rows) {
    let entry = byGame.get(row.gameId);
    if (!entry) {
      // `ended_at is not null` was just filtered above.
      entry = { startedAt: row.startedAt, endedAt: row.endedAt as Date, scores: [], myScore: 0 };
      byGame.set(row.gameId, entry);
    }
    entry.scores.push(row.rosterFinalScore);
    if (row.rosterClerkUserId === clerkUserId) entry.myScore = row.rosterFinalScore;
  }

  const games: CompletedGameForPlayer[] = [...byGame.entries()].map(([gameId, entry]) => {
    const placement = entry.scores.filter((score) => score > entry.myScore).length + 1;
    return {
      gameId,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      finalScore: entry.myScore,
      playerCount: entry.scores.length,
      placement,
      isWin: placement === 1,
    };
  });

  games.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return games;
}

/** Queries `word_plays` directly, across ALL games including abandoned ones
 * — a word_plays row exists the moment a word is accepted, independent of
 * whether the game later ended, unlike the completed-games-only figures
 * above. */
export async function getLongestWordPlayed(
  db: Kysely<Database>,
  clerkUserId: string,
): Promise<string | null> {
  const row = await db
    .selectFrom("word_plays")
    .where("clerk_user_id", "=", clerkUserId)
    .select("word")
    .orderBy((eb) => eb.fn("length", ["word"]), "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.word ?? null;
}

/** Same "all games including abandoned" scope as getLongestWordPlayed — see
 * its comment. */
export async function getLifetimeWordsPlayed(
  db: Kysely<Database>,
  clerkUserId: string,
): Promise<number> {
  const row = await db
    .selectFrom("word_plays")
    .where("clerk_user_id", "=", clerkUserId)
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  winRatePct: number | null; // null when gamesPlayed === 0
  /** Not comparable across games with different `minWordLength` configs —
   * a 3-letter-minimum game inflates scores relative to a 4-letter-minimum
   * game for equivalent play (CLAUDE.md's scoring formula). Meaningful as
   * "your own history over time," not as an apples-to-apples number. */
  avgScore: number | null;
  /** Same cross-config caveat as avgScore. */
  highestScore: number | null;
  longestWordPlayed: string | null;
  currentWinStreak: number;
  bestWinStreak: number;
  lifetimeWordsPlayed: number;
  lifetimeScore: number;
  avgGameDurationSec: number | null;
  recentGames: CompletedGameForPlayer[]; // most-recent-first, sliced to recentGamesLimit
}

export interface GetPlayerStatsOptions {
  recentGamesLimit?: number;
}

/** Fetches completed games once and derives every summary figure from that
 * single array in JS — including win streak, which is an inherently
 * sequential reset-on-loss fold, awkward to express in SQL (LAG/recursive
 * CTE) and trivial as a loop. Keeping every other figure (gamesPlayed,
 * wins, winRatePct, avgScore, highestScore, avgGameDurationSec,
 * lifetimeScore) derived the same way keeps one source of truth for "what
 * counts" instead of one SQL aggregate per figure. */
export async function getPlayerStats(
  db: Kysely<Database>,
  clerkUserId: string,
  options: GetPlayerStatsOptions = {},
): Promise<PlayerStats> {
  const recentGamesLimit = options.recentGamesLimit ?? 10;

  const [completedGames, longestWordPlayed, lifetimeWordsPlayed] = await Promise.all([
    getCompletedGamesForPlayer(db, clerkUserId), // most-recent-first
    getLongestWordPlayed(db, clerkUserId),
    getLifetimeWordsPlayed(db, clerkUserId),
  ]);

  const gamesPlayed = completedGames.length;
  const wins = completedGames.filter((game) => game.isWin).length;
  const scores = completedGames.map((game) => game.finalScore);
  const lifetimeScore = scores.reduce((sum, score) => sum + score, 0);
  const durationsSec = completedGames.map(
    (game) => (game.endedAt.getTime() - game.startedAt.getTime()) / 1000,
  );

  // completedGames is most-recent-first; current streak reads front-to-back
  // until the first loss, best streak needs the full chronological order.
  let currentWinStreak = 0;
  for (const game of completedGames) {
    if (!game.isWin) break;
    currentWinStreak += 1;
  }

  let bestWinStreak = 0;
  let runningStreak = 0;
  for (const game of [...completedGames].reverse()) {
    runningStreak = game.isWin ? runningStreak + 1 : 0;
    bestWinStreak = Math.max(bestWinStreak, runningStreak);
  }

  return {
    gamesPlayed,
    wins,
    winRatePct: gamesPlayed === 0 ? null : Math.round((wins / gamesPlayed) * 100),
    avgScore: gamesPlayed === 0 ? null : Math.round(lifetimeScore / gamesPlayed),
    highestScore: gamesPlayed === 0 ? null : Math.max(...scores),
    longestWordPlayed,
    currentWinStreak,
    bestWinStreak,
    lifetimeWordsPlayed,
    lifetimeScore,
    avgGameDurationSec:
      durationsSec.length === 0
        ? null
        : Math.round(durationsSec.reduce((sum, sec) => sum + sec, 0) / durationsSec.length),
    recentGames: completedGames.slice(0, recentGamesLimit),
  };
}
