import { expect, test } from "@playwright/test";

// The lobby vertical slice's manual QA steps (README "Getting started"),
// automated: two independent browser contexts (so each gets its own
// localStorage-backed player identity, like two separate devices) exercise
// the real WebSocket -> server -> Redis -> pub/sub -> WebSocket round trip —
// this is the one place that boundary is worth testing in a real browser
// (see CLAUDE.md "Testing strategy"); everything else about these pages is
// already covered by mocked component tests.

test("host creates a game and a guest joins via the invite link, live", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  await hostPage.goto("/");
  await hostPage.getByLabel("Your name").fill("Host Player");
  await hostPage.getByRole("button", { name: "Create game" }).click();

  await expect(hostPage).toHaveURL(/\/[A-Z0-9]{5}$/);
  await expect(hostPage.getByText("1 player at the table")).toBeVisible();

  const inviteUrl = hostPage.url();

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(inviteUrl);

  await guestPage.getByLabel("Your name").fill("Guest Player");
  await guestPage.getByRole("button", { name: "Join game" }).click();

  await expect(guestPage.getByText("Waiting for the host to start the game…")).toBeVisible();

  // No reload on the host's page — this only passes if the server actually
  // published PlayerJoined and the host's own socket received it.
  await expect(hostPage.getByText("2 players at the table")).toBeVisible();
  await expect(hostPage.getByText("Guest Player")).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});
