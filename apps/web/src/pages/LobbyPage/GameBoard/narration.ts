import type { LobbySnapshot, UsedWord } from "@anagrabble/protocol";
import type { WordPlayNarration } from "../../../hooks/useGameSocket";

export function playerName(lobby: LobbySnapshot, playerId: string): string {
  return lobby.players.find((p) => p.id === playerId)?.name ?? "Someone";
}

/** "You stole CAT from Sam -> CAST" (or, for a history row, "Ash stole CAT
 * from Sam -> CAST") — `actorLabel` is "You" for the toast (only ever fires
 * for the player who just played, see narrateOwnPlay's one call site) and
 * the actual player name for the history panel, since that list is shared
 * and must read correctly for any viewer. A play can combine more than one
 * claimed word (CLAUDE.md: "two or more existing claimed words combined"),
 * so a steal can pull from multiple opponents at once, or mix a stolen word
 * with one of the submitter's own — each usedWords entry gets its own
 * "WORD from Owner" (own words just show the bare word) and the whole play
 * is called a steal if *any* entry belonged to someone else. Extending only
 * your own word(s) shows the same "-> result" styling without
 * "stole"/"from" (e.g. "You played BAD -> BADGE"); a fresh pool-only play
 * with no prior word just says "played". */
export function describePlay(
  actorLabel: string,
  lobby: LobbySnapshot,
  play: { playerId: string; word: string; usedWords: UsedWord[] },
): string {
  const isSteal = play.usedWords.some((w) => w.ownerId !== play.playerId);
  if (isSteal) {
    const parts = play.usedWords.map((w) =>
      w.ownerId === play.playerId ? w.word : `${w.word} from ${playerName(lobby, w.ownerId)}`,
    );
    return `${actorLabel} stole ${parts.join(" + ")} → ${play.word}`;
  }
  if (play.usedWords.length > 0) {
    const origin = play.usedWords.map((w) => w.word).join(" + ");
    return `${actorLabel} played ${origin} → ${play.word}`;
  }
  return `${actorLabel} played ${play.word}`;
}

export function narrateOwnPlay(lobby: LobbySnapshot, play: WordPlayNarration): string {
  return describePlay("You", lobby, play);
}

export function describeJoined(name: string): string {
  return `${name} joined the game`;
}

/** Player-facing copy for a rejected SubmitWord, or `null` to show nothing.
 * `NoDecomposition` and `StaleState` share the same copy, deliberately —
 * from the player's side these are the same outcome ("what I tried isn't
 * currently possible"), just caught by different backend layers depending
 * on timing: `NoDecomposition` when the decomposition search itself
 * (packages/game) already sees nothing buildable (letters genuinely
 * unavailable, or the only option was a bare zero-addition resubmission —
 * those two are merged for the same reason), `StaleState` when the search
 * found something buildable but the atomic Lua re-verification found it
 * had been consumed by a faster play in the gap since (see CLAUDE.md "Word
 * resolution implementation split"). A player has no way to tell those
 * apart and no reason to care which one happened — so neither should the
 * copy. Also deliberately doesn't say "letters" — pool-only insufficient
 * and bare resubmission are different failures underneath, not just "the
 * upturned tiles don't have it".
 *
 * `DerivationBlocked` gets its own distinct copy: unlike the above, this
 * one's genuinely actionable — a decomposition *was* buildable, using real
 * new letters, but it's rejected specifically for being a trivial
 * dictionary derivation (packages/game's `isDerivedFrom`). Only ever
 * reported once letters are confirmed available, same anti-oracle ordering
 * as letters-before-dictionary (see docs/decisions.md "DerivationBlocked as
 * its own rejection reason"). The copy avoids naming a position ("ending",
 * "suffix") since the rule itself isn't positional — the dictionary data
 * only happens to record suffix-style derivations today, not prefixes (see
 * docs/decisions.md "Dictionary source and format" for that known gap).
 *
 * Note there's no "word already claimed" case at all — duplicate claims of
 * the identical word are allowed, as long as the letters are genuinely
 * available each time (see docs/decisions.md "Duplicate word claims are
 * allowed").
 *
 * `NotYourTurn` is suppressed rather than mapped to copy: the only way it
 * can reach this component is the turn-timer effect's own background
 * TurnTile auto-fire losing a race against another client (see
 * useTurnTimer) — the UI never lets a player deliberately click "Turn a
 * tile" when it isn't their turn, so it's never a rejection of something
 * the player actually did. */
export function errorText(
  code: string,
  minWordLength: number,
  attemptedWord: string,
  fallback: string,
): string | null {
  switch (code) {
    case "NotAWord":
      return `${attemptedWord.toUpperCase()} isn't in the dictionary`;
    case "TooShort":
      return `Words need to be at least ${minWordLength} letters`;
    case "NoDecomposition":
    case "StaleState":
      return "That's not a legal move";
    case "DerivationBlocked":
      return "You have to change the root";
    case "NotYourTurn":
      return null;
    default:
      return fallback;
  }
}
