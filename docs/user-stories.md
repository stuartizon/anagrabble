# Anagrabble — User Stories

Source of truth for product scope. Mirror individual stories into GitHub Issues for
sprint/status tracking if useful, but this file stays the canonical list — easy for
Claude Code to read alongside implementation work.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Account & entry
- [ ] As a player, I can sign up / log in so my games and stats persist.
- [ ] As a player, I can reset my password.

## Starting a game
- [x] As a host, I can create a new game and configure turn timer (15/30/45/60s),
      minimum word length (3/4/5 letters), and language.
- [x] As a host, I get a shareable invite link for the game lobby.
- [x] As a player, I can join a game via invite link.
- [~] As a player, I see who's in the lobby before the game starts, and the host can
      start the game once ready. Seeing the lobby live is done; the host's "Start
      game" button is present but not yet wired to anything (lands with the
      gameplay slice).

## Core gameplay
- [ ] As the current player, I can turn over one tile from the bank on my turn.
- [ ] As a player, if the current player's turn timer expires, the turn
      auto-advances to the next player (see CLAUDE.md: client-triggered for MVP).
- [ ] As any player, I can submit a word at any time, formable from pool letters,
      by stealing an opponent's word (extended or combined), or both.
- [ ] As a player, when I submit a word that's a valid steal, I see clearly whose
      word was taken and how (matches the narration style in the design prototype,
      e.g. "Sam stole CAT from You → CAST").
- [ ] As a player, if two of us submit overlapping words near-simultaneously, only
      one of us succeeds and I get clear feedback if I lost the race.
- [ ] As a player, I see live score and word-count updates for all players.
- [ ] As a player, I see a running history of plays in the current game.
- [ ] As a player, once the tile bank is empty, the game auto-ends after an idle
      period with no new words played (idle countdown resets on every play — see
      CLAUDE.md "Game-end condition"). Not a live-consensus mechanic for MVP.

## Post-game
- [ ] As a player, I see a game-over summary (final scores/words).
- [ ] As a player, I can view my stats across past games.

## Settings
- [ ] As a player, I can change interface language, sound, and haptics preferences
      (persisted per-user, not per-game).

## Non-functional / cross-cutting
- [ ] As a player, if my connection drops and reconnects mid-game, I see the
      correct current state (seq-based resync, no silent drift).
- [ ] As a player on mobile, the game is fully playable (design system has
      responsive rail/menu treatment already specified).

## Explicitly out of scope for MVP
- Computer/bot opponents (planned later per design system readme).
- Redis HA / multi-region.
- Turn-timer server-side polling sweep (see CLAUDE.md open decisions).
- Explicit player-consensus / "call the game" mechanic for ending a game (using
  the idle-countdown proxy instead, see CLAUDE.md).
