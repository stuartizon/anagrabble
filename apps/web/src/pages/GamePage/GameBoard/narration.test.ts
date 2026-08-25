import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@anagrabble/protocol";
import { describeJoined, describePlay, errorText, narrateOwnPlay, playerName } from "./narration";

const ME = { id: "me-1", name: "Me", words: [], score: 0 };
const OPPONENT = { id: "opp-1", name: "Sam", words: [], score: 0 };
const THIRD = { id: "third-1", name: "Ash", words: [], score: 0 };

function game(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    gameId: "ABCDE",
    hostId: "me-1",
    status: "playing",
    seq: 1,
    config: { turnTimerSec: 30, minWordLength: 3, language: "English" },
    turnPlayerId: "me-1",
    turnDeadline: null,
    endGameDeadline: null,
    bankCount: 100,
    pool: [],
    players: [ME, OPPONENT, THIRD],
    ...overrides,
  };
}

describe("playerName", () => {
  it("returns the matching player's name", () => {
    expect(playerName(game(), "opp-1")).toBe("Sam");
  });

  it("falls back to 'Someone' for an id not in the game", () => {
    expect(playerName(game(), "unknown")).toBe("Someone");
  });
});

describe("describePlay", () => {
  it("describes a fresh pool-only play with no prior word", () => {
    expect(describePlay("You", game(), { playerId: "me-1", word: "TAR", usedWords: [] })).toBe(
      "You played TAR",
    );
  });

  it("describes extending only your own word, without 'stole'/'from'", () => {
    expect(
      describePlay("You", game(), {
        playerId: "me-1",
        word: "BADGE",
        usedWords: [{ word: "BAD", ownerId: "me-1" }],
      }),
    ).toBe("You played BAD → BADGE");
  });

  it("describes a plain steal from one opponent", () => {
    expect(
      describePlay("You", game(), {
        playerId: "me-1",
        word: "CAST",
        usedWords: [{ word: "CAT", ownerId: "opp-1" }],
      }),
    ).toBe("You stole CAT from Sam → CAST");
  });

  it("describes a steal combining words from two different opponents", () => {
    expect(
      describePlay("You", game(), {
        playerId: "me-1",
        word: "CATDOG",
        usedWords: [
          { word: "CAT", ownerId: "opp-1" },
          { word: "DOG", ownerId: "third-1" },
        ],
      }),
    ).toBe("You stole CAT from Sam + DOG from Ash → CATDOG");
  });

  it("describes a steal that combines an opponent's word with the actor's own", () => {
    expect(
      describePlay("You", game(), {
        playerId: "me-1",
        word: "CATBAD",
        usedWords: [
          { word: "CAT", ownerId: "opp-1" },
          { word: "BAD", ownerId: "me-1" },
        ],
      }),
    ).toBe("You stole CAT from Sam + BAD → CATBAD");
  });

  it("uses the given actorLabel verbatim, e.g. a player's name for a third-person history row", () => {
    expect(
      describePlay("Sam", game(), {
        playerId: "opp-1",
        word: "CAST",
        usedWords: [{ word: "CAT", ownerId: "me-1" }],
      }),
    ).toBe("Sam stole CAT from Me → CAST");
  });
});

describe("narrateOwnPlay", () => {
  it("delegates to describePlay with 'You' as the actor label", () => {
    expect(narrateOwnPlay(game(), { seq: 2, playerId: "me-1", word: "TAR", usedWords: [] })).toBe(
      "You played TAR",
    );
  });
});

describe("describeJoined", () => {
  it("names the player who joined", () => {
    expect(describeJoined("Sam")).toBe("Sam joined the game");
  });
});

describe("errorText", () => {
  it("names the attempted word, uppercased, for NotAWord", () => {
    expect(errorText("NotAWord", 3, "xyzzy", "fallback")).toBe("XYZZY isn't in the dictionary");
  });

  it("includes the game's minWordLength for TooShort", () => {
    expect(errorText("TooShort", 5, "hi", "fallback")).toBe("Words need to be at least 5 letters");
  });

  it("shows the same copy for NoDecomposition and StaleState", () => {
    expect(errorText("NoDecomposition", 3, "cat", "fallback")).toBe("That's not a legal move");
    expect(errorText("StaleState", 3, "cat", "fallback")).toBe("That's not a legal move");
  });

  it("shows distinct copy for DerivationBlocked, not the generic 'not a legal move' text", () => {
    expect(errorText("DerivationBlocked", 3, "cats", "fallback")).toBe(
      "You have to change the root",
    );
  });

  it("suppresses NotYourTurn — never shown as a toast", () => {
    expect(errorText("NotYourTurn", 3, "cat", "fallback")).toBeNull();
  });

  it("falls back to the server's message for an unmapped code", () => {
    expect(errorText("SomethingElse", 3, "cat", "raw server message")).toBe("raw server message");
  });
});
