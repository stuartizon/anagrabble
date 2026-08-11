# Anagrabble — User Stories

Source of truth for product scope. Mirror individual stories into GitHub Issues for
sprint/status tracking if useful, but this file stays the canonical list — easy for
Claude Code to read alongside implementation work.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Home & rules

- [x] As a visitor, I land on a home page introducing Anagrabble before I sign
      in or start a game (design-system `Home.dc.html`) — distinct from `/`,
      which today goes straight to the create-game form with no separate
      landing/marketing surface. `HomePage` now owns `/`; the create-game
      form moved to `/new` (still `RequireAuth`-gated). Its "Create a game"
      button always targets `/new` regardless of sign-in state — no
      client-side login branching like the design mock's `createHref`, since
      `RequireAuth` already redirects to `/login` and back. The design's
      "Read the full rules →" link is left out until the standalone rules
      page (next bullet) exists to link to.
- [x] As a visitor, I can read the full rules on a standalone page, linked
      from the home page (design-system `Rules.dc.html`). `RulesPage` at
      `/rules`, not `RequireAuth`-gated. Content lives in its own
      `RulesContent` component (design-system `RulesContent.dc.html`),
      separate from the page chrome, so the next bullet's in-place modal
      can reuse it rather than duplicating the copy. `HomePage`'s "Read the
      full rules →" link (previously left out, see prior bullet) now
      points at it.
- [x] As a player, I can open the rules as an in-place modal, without
      navigating away, while setting up or waiting on a game — New Game,
      Join Game, and Lobby all have a "Rules" link in the design system —
      reusing the same rules content as the standalone page rather than
      duplicating it. The design mock's link disagrees with itself on
      copy/alignment across those three screens; normalized to one
      consistent `RulesLink` ("Review the rules", left-justified) used on
      `NewGamePage` and `LobbyPage` (which covers both Join Game and
      Lobby — no separate join page exists) — see docs/decisions.md
      "Rules modal: one consistent link, not per-page copy/alignment".

## Account & entry

- [x] As a player, I can sign up / log in so my games and stats persist.
      Login/signup screen built end to end against real Clerk (email/
      password + "Continue with Google"), matching
      design-system/`Log in, Sign up.dc.html` — see docs/decisions.md
      "Auth provider: Clerk, not a hand-rolled `users` table". Sign-in is now
      required for gameplay (`RequireAuth` gates `/` and `/:gameId`, no
      anonymous play) and player identity is the Clerk user id/account name,
      not a local stub — see docs/decisions.md "Player identity: Clerk id, no
      anonymous play". "games/stats persist" in the durable sense is now
      wired end to end: `apps/server/src/index.ts` inserts a `games` row on
      `StartGame`, a `word_plays` row on `SubmitWord`, and updates
      `games.ended_at`/inserts final `game_players` rows on `EndGame` — all
      fire-and-forget per docs/postgres-schema.md, all linked to the Clerk
      user id. Viewing that history is a separate, not-yet-started story
      (below, "As a player, I can view my stats across past games").
- [x] As a player, I can reset my password.
      `LoginPage`'s "Forgot password?" link swaps the card into a third
      mode: enter your email, enter the emailed code alongside a new
      password, then straight into the app signed in. Built against real
      Clerk (`reset_password_email_code`), not a mock — see
      docs/decisions.md "Password reset: code entry, not the design
      mock's magic link" for why this uses a code instead of the design
      mock's magic-link step, and why it auto-signs the visitor in
      afterward rather than sending them back to log in again.

## Starting a game

- [x] As a host, I can create a new game and configure turn timer (15/30/45/60s),
      minimum word length (3/4/5 letters), and language.
- [x] As a host, I get a shareable invite link for the game lobby.
- [x] As a player, I can join a game via invite link.
- [x] As a player, I see who's in the lobby before the game starts, and the host can
      start the game once ready.

## Core gameplay

- [x] As the current player, I can turn over one tile from the bank on my turn.
- [x] As a player, if the current player's turn timer expires, the turn
      auto-advances to the next player (see CLAUDE.md: client-triggered for MVP).
- [x] As any player, I can submit a word at any time, formable from pool letters,
      by stealing an opponent's word (extended or combined), or both. End to end:
      decomposition search, atomic Redis mutation, SubmitWord/WordPlayed wire
      types, and a word-input UI in `GameBoard` — verified in a real browser
      against the real backend (create/join/start/turn/play/steal, two
      players, no console errors).
- [x] As a player, when I submit a word that's a valid steal, I see clearly whose
      word was taken and how (matches the narration style in the design prototype,
      e.g. "You stole CAT from Sam → CAST") — `GameBoard`'s toast message,
      driven by `WordPlayedEvent.usedWords`. Scoped to the actor's own play only —
      other players' plays don't toast (see docs/decisions.md "Toasts are
      personal, not broadcast narration"); that's the persistent history
      panel's job once it exists, desktop-only per the design source.
- [x] As a player, if two of us submit overlapping words near-simultaneously, only
      one of us succeeds (guaranteed by `apply_submit_word.lua`'s atomic
      re-verification, with its own concurrent-race test) and the loser sees
      "That's not a legal move right now." — the same copy as any other
      currently-illegal attempt (`StaleState` and `NoDecomposition` share
      copy deliberately; see docs/decisions.md). Mechanism fully tested at
      the Lua/wrapper layers; not separately re-verified as a live
      two-browser race in this pass.
- [x] As a player, I see live score and word-count updates for all players.
      Score is live (`GameBoard`'s sidebar Players list, matching
      design-system/In Game.dc.html's desktop layout). A separate numeric
      word-count badge was considered and deliberately dropped — see
      docs/decisions.md "Word-count badge dropped, not deferred": each
      player's claimed-words list is already visible (desktop sidebar and
      the main board's word sections), so a redundant digit next to score
      wasn't judged worth building.
- [x] As a player, I see a running history of plays in the current game.
      `GameBoard`'s desktop-only History panel, driven by a `history` array
      `useGameSocket` accumulates from `WordPlayed` events — newest-first,
      third-person narration for every player (not just the actor, unlike
      the toast). Client-side only, resets on a fresh connection rather than
      surviving a reconnect — see docs/decisions.md "History panel is
      client-side only, not persisted anywhere server-side". Player
      word-count badges are a separate follow-up piece of work, not bundled
      here.
- [x] As a player, once the tile bank is empty, the game auto-ends after an idle
      period with no new words played (idle countdown resets on every play — see
      CLAUDE.md "Game-end condition"). Not a live-consensus mechanic for MVP.
      End to end: `EndGame`/`GameEndedEvent`, `apply_end_game.lua`'s atomic
      deadline check (own concurrent-race test), the apps/server wrapper, and
      GameBoard's client-triggered auto-fire + a minimal "Game over" banner
      that disables the word form — see docs/decisions.md "Game-end
      condition" for the implementation note. The idle timeout stays
      hardcoded at 60s (not yet the "configurable" CLAUDE.md describes), and
      the full game-over summary screen is still its own separate,
      not-yet-started story below.

## Post-game

- [x] As a player, I see a game-over summary (final scores/words).
      `GameOverSummary` — matches design-system/Game Over.dc.html: replaces
      GameBoard entirely once `lobby.status === "ended"` (own screen, not an
      overlay on the board — see LobbyPage), ranked by score with
      competition-style ranks (a tie shows the same rank number, e.g.
      1, 1, 3) and a "Sam wins with 8."/"Sam and Jo tie at 6." winner
      line, each player's claimed words as tags, "New game" back to `/`.
      Uses `PlayerState.words`/`score` already on `LobbySnapshot` — no
      protocol change needed.
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
