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

One row per completed-or-in-progress game, one row per player in it. Enough
for the common-case stats query (games played, final score per game, win
rate) without touching `word_plays` at all. `clerk_user_id` is a bare
foreign key to Clerk's identity, not a local `users` table — see
`docs/decisions.md` "Auth provider: Clerk, not a hand-rolled `users` table."

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

### `player_settings`

Per-Clerk-user app preferences (language, sound, haptics — the still-open
Settings user story), keyed directly on `clerk_user_id`. Provisioning
(lazy-upsert-on-first-save vs. a Clerk `user.created` webhook) is not yet
decided — see "Known limitations" below.

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
- **`player_settings` provisioning is undecided** — lazy upsert on first
  settings save vs. a Clerk `user.created` webhook creating the row
  proactively. Webhooks are more robust (row exists before it's needed,
  handles account deletion cleanly via `user.deleted`) but are a small
  piece of new infra (an endpoint Clerk calls) not yet built. Decide when
  the Settings story is picked up.
- **`TileTurned`/lobby events write nothing to Postgres.** `TileTurned` is
  pure random-reveal noise (up to 144 rows/game) with no stat value;
  `PlayerJoined`/`PlayerLeft`/`GameStarted` are lobby-level and whatever
  value they'd have (e.g. game duration) is already covered by
  `games.started_at`/`ended_at`. Revisit only if a concrete stat idea
  actually needs one of these.
