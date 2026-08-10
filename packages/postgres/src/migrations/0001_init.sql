-- Schema contract lives in docs/postgres-schema.md — this migration mirrors
-- it verbatim. Update both together if the shape ever changes.

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
