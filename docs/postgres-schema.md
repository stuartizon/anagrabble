# Postgres schema

Convention for the durable-history side of the store — see CLAUDE.md "Core
architecture" for why this exists at all, and `docs/redis-schema.md` for the
live-state side it complements. This file is the concrete table/shape
contract, same role for Postgres that `redis-schema.md` plays for Redis.

## Scope: stats/audit history, not a Redis-recovery source

Postgres records **completed, permanent history** for stats and lookup —
"what happened," after the fact. It is explicitly **not** a mechanism for
reconstructing an in-progress game if Redis is lost. That's a materially
different property (would need recovery-grade write guarantees on the
critical path, not the async/off-critical-path writes described below) and
isn't something this schema is designed for. If a Redis node dies, live-game
recovery is purely Redis's own concern (persistence/replication, Sentinel or
cluster HA — see `docs/decisions.md` "Redis hosting", still undecided,
single-instance for MVP); Postgres plays no role in that scenario, and an
in-progress game not surviving it is an accepted MVP-scope gap. See
`docs/decisions.md` "Postgres scope: stats/audit history, not Redis
recovery" for the fuller reasoning.

## Writes are async, after Redis, never on the critical path

Every write here happens _after_ Redis has already accepted and broadcast
the corresponding move — never blocking a command's response, never part of
`apply_*.lua`'s atomicity. A failed or delayed Postgres write never fails or
stalls a live move; it just means that write is retried or (today) silently
lost, an accepted gap at MVP scale (see "Known limitations" below).

| Redis event           | Postgres write                                                |
| --------------------- | ------------------------------------------------------------- |
| `StartGame` accepted  | insert `games` row (a lobby that never starts never gets one) |
| `WordPlayed` accepted | insert `word_plays` row                                       |
| `GameEnded` accepted  | update `games.ended_at`; insert final `game_players` rows     |

`TileTurned`, `PlayerJoined`/`PlayerLeft`, and `GameStarted` deliberately
write nothing here — see "Known limitations" below for why.

## Tables

```sql
create table games (
  id            text primary key,          -- same id as the Redis game key
  config        jsonb not null,            -- {turnTimerSec, minWordLength, language}
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,               -- null until GameEnded lands
  created_at    timestamptz not null default now()
);

create table game_players (
  game_id       text not null references games(id),
  clerk_user_id text not null,             -- Clerk id; no local users table, see below
  name          text not null,             -- snapshot at game-end — Clerk names can change later
  player_index  int not null,              -- players[0] == host, per redis-schema.md "Host convention"
  final_score   int not null,
  final_words   text[] not null,
  primary key (game_id, clerk_user_id)
);

create table word_plays (
  id                bigserial primary key,
  game_id           text not null references games(id),
  seq               int not null,           -- Redis seq at the moment of this play — canonical order
  clerk_user_id     text not null,          -- who played it
  word              text not null,
  used_words        jsonb not null,         -- [{word, ownerId}] — prior claimed words this play consumed (steals/extensions)
  used_pool_letters text[] not null,
  created_at        timestamptz not null default now(),
  unique (game_id, seq)                     -- idempotent on retry of the async write
);

create table player_settings (
  clerk_user_id   text primary key,
  language        text not null default 'English',
  sound_enabled   boolean not null default true,
  haptics_enabled boolean not null default true,
  updated_at      timestamptz not null default now()
);
```

### `games` / `game_players`

One `games` row per game that started, whether or not it's finished yet.
`game_players` rows, by contrast, are written only once (on `GameEnded` —
see the event table above), so an in-progress or abandoned game has a
`games` row but no `game_players` rows at all yet. This turns out to be
exactly what the per-player stats query wants — see "Player stats" below —
without touching `word_plays` at all. `clerk_user_id` is a bare foreign key
to Clerk's identity, not a local `users` table — see `docs/decisions.md`
"Auth provider: Clerk, not a hand-rolled `users` table."

### `word_plays`

Named for what it actually holds, not a generic event log — see
`docs/decisions.md` "`word_plays`, not a generic `game_events` table" for why
`TileTurned`/lobby events were ruled out and the table narrowed to this one
purpose. This is the only table that preserves _how_ a word was formed
(steal chains, pool-letter usage), which `game_players.final_words` (a flat
list of strings at game-end) cannot — needed for any stat that isn't a
simple per-game total: steal counts, longest word-derivation chain (e.g. CAT
→ CAST → CASTS → FORECASTS), etc. It's also the durable fallback candidate
named in `docs/decisions.md` "Reconnect/mid-game-join history backfill" for
backfilling a late joiner's history, if that's ever built.

`used_words` stays a jsonb array rather than its own normalized join table
for now — chain reconstruction happens by walking it in application code
(match a play's `word` against a later play's `used_words` entries), not by
a SQL recursive CTE. Simpler to write, fine at this scale; revisit as a
normalized `word_play_sources(word_play_id, source_word_play_id)` table only
if chains ever need to be queried in pure SQL.

### Player stats (`packages/postgres/src/stats.ts`)

Backs `GET /stats` (`apps/server/src/stats.ts`) — games played, wins, win
rate, average/highest score, longest word, win streak, lifetime totals,
average game length, all scoped to one `clerk_user_id`. A few scope
decisions worth recording here rather than only in code comments:

- **"Games played" is completed games only, by construction.** Falls
  straight out of the `games`/`game_players` shape above — a
  `game_players` row only exists once `GameEnded` is accepted, so an
  abandoned game is excluded without an extra `WHERE ended_at IS NOT NULL`
  to get wrong. Considered writing a roster row earlier (at `StartGame`/
  lobby join) so abandoned games show up too — rejected for now: it's not
  obviously what "games played" should mean (a game joined and immediately
  abandoned without a word played arguably shouldn't count), and
  `final_score`/`final_words` are `not null` today specifically because a
  row only ever represents a _finished_ result — supporting an in-progress
  row would mean a nullable `final_score` or a status column, and every
  stats query that currently gets "completed-only" for free via
  row-existence would need an explicit filter instead. Worth its own
  decision if "abandoned games" ever becomes a wanted stat.
- **Win streak, and every other summary figure, is derived in JS from one
  fetched roster query**, not one SQL aggregate per figure — win streak in
  particular is a sequential reset-on-loss fold, awkward in SQL
  (`LAG`/recursive CTE) and trivial as a loop; keeping the rest consistent
  with it means one source of truth for "what counts."
- **Longest word played / lifetime words played query `word_plays`
  directly, across ALL games including abandoned ones** — unlike the
  score-based figures above, a `word_plays` row exists the moment a word
  is accepted, independent of whether the game later ended.
- **Average/highest score are not comparable across games with different
  `minWordLength` configs** (CLAUDE.md's scoring formula gives a
  3-letter-minimum game higher raw scores than a 4-letter-minimum game for
  equivalent play) — kept anyway as "your own history over time," not
  presented as an apples-to-apples number. A score-over-time chart was
  considered and dropped for the same reason, more sharply: a chart makes
  the comparison implicit and visual, which is actively misleading rather
  than just imprecise.

### `player_settings`

Per-Clerk-user app preferences (language, sound, haptics — see
docs/user-stories.md "Settings"), keyed directly on `clerk_user_id`.
Provisioning is lazy upsert on first settings save — no row exists until a
player saves once; `GET /settings` returns the table's own column defaults
in that case (`packages/postgres/src/settings.ts`'s
`DEFAULT_PLAYER_SETTINGS`, kept in sync by hand with the schema below). See
docs/decisions.md "Settings: player_settings provisioning" for why this was
chosen over a Clerk `user.created` webhook.

## Known limitations (deliberate, MVP-scope)

- **Not recovery-capable.** See "Scope" above — a genuine Redis data-loss
  event (not just a node restart) leaves an in-progress game unrecoverable.
  Accepted MVP risk, not a gap this schema tries to close.
- **No retry/durability on the async write path itself.** "Written after
  Redis accepts a move" today means a plain fire-and-forget insert; a
  failed write (Postgres blip, network error) is currently just lost, not
  queued or retried. Acceptable at current scale (few concurrent games);
  revisit (e.g. an outbox pattern) if silently-missing history rows ever
  becomes a real problem.
- **`TileTurned`/lobby events write nothing to Postgres.** `TileTurned` is
  pure random-reveal noise (up to 144 rows/game) with no stat value;
  `PlayerJoined`/`PlayerLeft`/`GameStarted` are lobby-level and whatever
  value they'd have (e.g. game duration) is already covered by
  `games.started_at`/`ended_at`. Revisit only if a concrete stat idea
  actually needs one of these.
- **Abandoned games have no recorded roster at all — not even who was in
  them.** Since `game_players` rows only exist once `GameEnded` is
  accepted (see "`games` / `game_players`" above), a game that was started
  but never finished has a `games` row and nothing else — no way to know
  which players were part of it. Fine for today's only consumer (the stats
  query, which deliberately wants completed-only — see "Player stats"
  above), but would block anything that ever wants to reason about
  abandoned games specifically (e.g. an "abandon rate" stat).
