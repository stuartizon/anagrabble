import { expect, test } from "@playwright/test";

// Real-WS-boundary regression coverage for the reconnect/resync story
// (docs/user-stories.md "Non-functional / cross-cutting" — connection
// drops and reconnects mid-game; useGameSocket's backoff, commit a7da803).
// See docs/decisions.md "Reconnect-with-backoff: scope calls made, not
// blockers" for the "Verified live" note this test formalizes.
//
// `browserContext.setOffline()` was tried first and discarded — Chromium's
// CDP offline emulation doesn't interrupt an already-open WebSocket, so it
// never actually exercised the reconnect path (state kept updating live
// straight through the "offline" window). Force-closing the real
// `WebSocket` object from page context is what actually reproduces an
// unexpected drop from the client's point of view, so that's what this
// test does — captured via a `window.WebSocket` proxy installed before
// navigation (`addInitScript`), the same trick as the app has no other way
// to reach the socket instance from outside the hook.
const captureSocketInit = `
  (() => {
    const NativeWS = window.WebSocket;
    window.__lastSocket = null;
    window.__socketCount = 0;
    window.WebSocket = new Proxy(NativeWS, {
      construct(target, args) {
        const instance = new target(...args);
        instance.__seq = ++window.__socketCount;
        window.__lastSocket = instance;
        return instance;
      },
    });
  })();
`;

test("a dropped connection reconnects with backoff and resyncs to current state", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  await hostContext.addInitScript(captureSocketInit);
  const hostPage = await hostContext.newPage();

  await hostPage.goto("/new");
  await hostPage.getByRole("button", { name: "Alice" }).click();
  // Longest available turn timer — the test needs the game's own turn-timer
  // auto-advance (any connected client fires TurnTile once a deadline
  // passes, CLAUDE.md "Turn timer enforcement") to NOT fire mid-test and
  // change the bank count out from under the assertions below.
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

  // Host and guest are two independent WS connections — there's no
  // ordering guarantee between when host's own DOM reflects a mutation and
  // when guest's does (or vice versa). Every read below waits for that
  // specific page's own text to actually change before capturing it,
  // rather than inferring "it must have updated by now" from something a
  // *different* page observed — that race (reading host's bank count right
  // after waiting on guest's button to appear) is what made this test flaky
  // the first few times.
  const hostBank = hostPage.getByText("tiles left");
  const guestBank = guestPage.getByText("tiles left");
  await expect(hostBank).toBeVisible();
  await expect(guestBank).toBeVisible();
  const initialBankText = await hostBank.innerText();

  // Host turns first (turnPlayerIndex starts at 0) — this also hands the
  // turn to the guest (apply_turn_tile.lua advances turnPlayerIndex on
  // every turn, not just on a word play), so the guest can turn the tile
  // used below as proof-of-resync without needing a real dictionary word.
  await hostPage.getByRole("button", { name: /Turn a tile/ }).click();
  await expect(hostBank).not.toHaveText(initialBankText);
  const bankBeforeDrop = await hostBank.innerText();
  const socketSeqBeforeDrop = await hostPage.evaluate(() => window.__lastSocket?.__seq);

  // --- Simulate an unexpected drop on the host's connection only ---
  await hostPage.evaluate(() => window.__lastSocket?.close(4000, "simulated drop"));
  await expect(hostPage.getByText("Reconnecting…")).toBeVisible();

  // Real state change while the host's socket is down: the guest turns a
  // tile the host never sees a live TileTurned event for.
  await expect(guestPage.getByRole("button", { name: /Turn a tile/ })).toBeVisible();
  await guestPage.getByRole("button", { name: /Turn a tile/ }).click();
  await expect(guestBank).not.toHaveText(bankBeforeDrop);
  const bankDuringDrop = await guestBank.innerText();

  // First backoff attempt is RECONNECT_DELAYS_MS[0] (1s) — wait for the
  // hook to actually reopen a new socket and the indicator to clear, rather
  // than a fixed sleep.
  await expect(hostPage.getByText("Reconnecting…")).toBeHidden({ timeout: 10_000 });
  const socketSeqAfterReconnect = await hostPage.evaluate(() => window.__lastSocket?.__seq);
  expect(socketSeqAfterReconnect).toBeGreaterThan(socketSeqBeforeDrop);

  // The actual proof: the host picks up the guest's tile-turn purely via
  // the resync-on-connect snapshot, having missed the live event entirely.
  await expect(hostBank).toHaveText(bankDuringDrop);

  await hostContext.close();
  await guestContext.close();
});
