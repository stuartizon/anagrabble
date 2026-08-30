import { expect, test, type Page } from "@playwright/test";

// Real-WS-boundary regression coverage for word claiming/stealing — the
// whole reason the Redis/atomicity design exists (CLAUDE.md "Word
// submission/stealing is free-for-all... the actual 'first wins' race").
// Everything about the word-formability *rules* (priority, tiebreak,
// derivation blocking) is already covered by packages/game's property-based
// tests; the decomposition search and its dictionary lookups are covered by
// resolution.test.ts. What's only provable here is that typing a word into
// the real UI, on a real page, actually reaches the server over a real
// WebSocket and comes back as a claimed/stolen word on both players' real
// rendered boards — the one thing CLAUDE.md's testing strategy flagged
// this suite should extend to "once gameplay lands" (anagrabble#41), which
// it since has without this spec following.
//
// The tile bag shuffles with real Math.random() (packages/game/src/bag.ts),
// so there's no way to force a specific word into the pool directly —
// instead this repeatedly turns tiles (alternating players, since turning a
// tile also transfers the turn) until the pool actually contains the
// letters needed, same spirit as reconnect.spec.ts/presence.spec.ts turning
// tiles for their own purposes, just driven by a letter-availability check
// instead of a fixed count. C is the bottleneck letter (only 3 of the
// bag's 144 tiles — packages/game/src/bag.ts's LETTER_COUNTS), so the turn
// cap and test timeout below are sized generously around that, not the
// more common A/T/S.

const MAX_TILE_TURNS = 130;

function poolHasLetters(poolText: string, letters: string): boolean {
  const counts = new Map<string, number>();
  for (const ch of poolText) {
    if (/[A-Z]/.test(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  for (const ch of letters) {
    const remaining = counts.get(ch) ?? 0;
    if (remaining <= 0) return false;
    counts.set(ch, remaining - 1);
  }
  return true;
}

// Minimum gap between one tile-turn click and the next. Host and guest
// strictly alternate turns, so a given player's own clicks land 2x this
// value apart — kept above 500ms so that stays under the server's
// per-connection sustained rate limit (apps/server/src/rateLimiter.ts's
// GAMEPLAY_RATE_LIMIT: 5 burst / 1 per sec refill). Clicking with no pacing
// at all outruns that limit once several turns land within the same second,
// and a rejected TurnTile is silent by design (same as NotYourTurn —
// CLAUDE.md "Report bugs, not rejections"), so it'd otherwise surface only
// as the bank mysteriously not moving (anagrabble#52). The rate limiter's
// own behavior already has real end-to-end coverage in
// apps/server/src/server.test.ts's "rate limiting" suite — this pacing just
// keeps this spec from tripping it as a side effect of an unrelated flow.
const TURN_PACE_MS = 600;

/** Alternates clicking "Turn a tile" on whichever page currently has the
 * turn until the upturned pool contains every letter in `letters`, then
 * returns. Bails loudly rather than hanging forever if the bag runs dry
 * first. */
async function turnTilesUntilPoolHas(hostPage: Page, guestPage: Page, letters: string) {
  const hostBank = hostPage.getByText("tiles left");
  const hostTurnButton = hostPage.getByRole("button", { name: /Turn a tile/ });
  const guestTurnButton = guestPage.getByRole("button", { name: /Turn a tile/ });
  for (let turns = 0; turns < MAX_TILE_TURNS; turns++) {
    const poolText = await hostPage.getByTestId("pool-tiles").innerText();
    if (poolHasLetters(poolText, letters)) return;

    const bankBefore = await hostBank.innerText();
    if (await hostTurnButton.isVisible()) {
      await hostTurnButton.click();
    } else {
      await expect(guestTurnButton).toBeVisible();
      await guestTurnButton.click();
    }
    await expect(hostBank).not.toHaveText(bankBefore);
    await hostPage.waitForTimeout(TURN_PACE_MS);
  }
  throw new Error(`pool never contained "${letters}" after ${MAX_TILE_TURNS} tile turns`);
}

test("a claimed word can be stolen into a new word by another player, live", async ({
  browser,
}) => {
  // The turn-tile loop needs real time to draw enough of a 144-tile bag to
  // reliably surface C (only 3 copies), plus TURN_PACE_MS per turn in the
  // worst case (MAX_TILE_TURNS) — well past Playwright's 30s default.
  test.setTimeout(180_000);

  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  await hostPage.goto("/new");
  await hostPage.getByRole("button", { name: "Alice" }).click();
  // Generous turn timer — the tile-turning loop below needs room to run
  // without the background auto-fire (any client, once a deadline passes)
  // racing our own deliberate clicks and consuming an extra tile.
  await hostPage.getByLabel("Turn timer").selectOption("60");
  await hostPage.getByRole("button", { name: "Create game" }).click();
  await expect(hostPage).toHaveURL(/\/[A-Z0-9]{5}$/);
  const inviteUrl = hostPage.url();

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(inviteUrl);
  await guestPage.getByRole("button", { name: "Bob" }).click();
  await guestPage.getByRole("button", { name: "Join game" }).click();
  await expect(hostPage.getByText("2 players at the table")).toBeVisible();

  await hostPage.getByRole("button", { name: "Start game" }).click();
  await expect(hostPage.getByTestId("pool-tiles")).toBeVisible();
  await expect(guestPage.getByTestId("pool-tiles")).toBeVisible();

  // --- Claim: host plays CAT from the pool ---
  await turnTilesUntilPoolHas(hostPage, guestPage, "CAT");

  await hostPage.getByPlaceholder("Type a word…").fill("cat");
  await hostPage.getByRole("button", { name: "Play word" }).click();

  // exact: true — "CAT" also appears as a substring of the toast ("You
  // played CAT") and history ("Alice played CAT") text; only the word tag
  // itself has "CAT" as its complete text.
  await expect(hostPage.getByText("CAT", { exact: true })).toBeVisible();
  // The guest's board reflects the claim live, no reload — proof the play
  // actually went through the server, not just host-side optimistic UI.
  await expect(guestPage.getByText("CAT", { exact: true })).toBeVisible();

  // --- Steal: guest extends CAT into CAST using a pool S ---
  // CLAUDE.md's own worked example of a steal (CAT + S = CAST) — CAST has
  // no recorded dictionary root, so this isn't blocked as a trivial
  // derivation (unlike e.g. CAT -> CATS, which is).
  await turnTilesUntilPoolHas(hostPage, guestPage, "S");

  await guestPage.getByPlaceholder("Type a word…").fill("cast");
  await guestPage.getByRole("button", { name: "Play word" }).click();

  // CAT moves out of the host's word list, replaced by CAST under the
  // guest's — visible on both real, independently-rendered boards.
  await expect(hostPage.getByText("CAST", { exact: true })).toBeVisible();
  await expect(hostPage.getByText("No words")).toBeVisible();
  await expect(guestPage.getByText("CAST", { exact: true })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});
