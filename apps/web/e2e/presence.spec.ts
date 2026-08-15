import { expect, test } from "@playwright/test";
import { captureSocketInit } from "./socketCapture";

// Real-WS-boundary regression coverage for the player presence story
// (docs/user-stories.md "Non-functional / cross-cutting" — presence/
// fast-skip/host-migration; docs/decisions.md "Player presence:
// connected/disconnected/left tracking"). Everything about the presence
// *logic* (Lua deadline check, host derivation, badge rendering from a
// `presence` prop) is already covered by Vitest — what's only provable
// here is that a real WS close on one browser actually propagates through
// the server (close handler -> applyPresence -> publish LobbyState) to
// another real browser's rendered UI and its own background TurnTile
// auto-fire, exactly the round trip that was silently broken until
// GameBoard's turn-timer effect learned to check presence too (see that
// commit) — the client had a server-accepted early-turn path with no
// client code that ever attempted to use it.

test("a disconnected current player's turn is force-advanced for other players well before the full timer", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  await hostContext.addInitScript(captureSocketInit);
  const hostPage = await hostContext.newPage();

  await hostPage.goto("/new");
  await hostPage.getByRole("button", { name: "Alice" }).click();
  // Longest available turn timer — proves the turn actually advances via
  // the presence fast-skip, not just the ordinary deadline elapsing
  // underneath a generous assertion timeout.
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

  const guestBank = guestPage.getByText("tiles left");
  await expect(guestBank).toBeVisible();
  const initialBankText = await guestBank.innerText();
  const initialBankCount = parseInt(initialBankText, 10);

  // Host goes first (turnPlayerId starts as the host) — force-close their
  // socket before they ever turn a tile, so the guest is left waiting on a
  // disconnected current player.
  await hostPage.evaluate(() => window.__lastSocket?.close(4000, "simulated drop"));

  // The guest sees Alice marked away...
  await expect(guestPage.locator('svg[aria-label="Reconnecting…"]')).toBeVisible({
    timeout: 15_000,
  });

  // ...and the turn gets force-advanced well before the 60s turnTimerSec —
  // purely from the guest's own background TurnTile auto-fire noticing the
  // current player is unreachable, with no click and no reconnect from the
  // host at all.
  await expect(guestBank).not.toHaveText(initialBankText, { timeout: 20_000 });

  // Exactly one tile drawn by the force-advance, not two — regression
  // coverage for the turnPlayerIndex -> turnPlayerId bug (docs/decisions.md
  // "Turn ownership: turnPlayerIndex -> identity-based, not array
  // position"). With a 2-player game and the host disconnected, the old
  // position-based advance handed the turn straight back to the (still
  // disconnected) host, which let the guest's own auto-fire effect notice
  // an unreachable current player again and immediately fire a second
  // TurnTile — one force-advance, two tiles drawn. Asserting "the count
  // changed" alone is exactly what let that regression ship unnoticed.
  const afterAdvanceText = await guestBank.innerText();
  expect(parseInt(afterAdvanceText, 10)).toBe(initialBankCount - 1);

  // Give a would-be second auto-fire a beat to happen, then confirm the
  // count held — the guest is now the reachable current player, so nothing
  // should draw again without an actual click.
  await guestPage.waitForTimeout(3000);
  await expect(guestBank).toHaveText(afterAdvanceText);

  await hostContext.close();
  await guestContext.close();
});
