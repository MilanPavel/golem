import { expect, test } from "./fixtures.ts";
import { railConnected, startStack } from "./stack.ts";

test("Settings › Context opens from the card at the end of Routing, and scrolls inside the settings pane, never the window", async ({ page, rig }) => {
  const stack = await startStack(rig);
  await page.goto(stack.gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await page.goto(new URL("/settings/routing", stack.gateway.url).href);
  await expect(page.getByRole("heading", { name: "How a new chat picks its model" })).toBeVisible();

  const card = page.getByRole("region", { name: "Context window and long chats" });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: "Settings › Context →" }).click();
  await expect(page).toHaveURL(/\/settings\/context$/);
  await expect(page.getByRole("heading", { name: "When the window fills up" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Right now" })).toBeVisible();

  // Nothing on the page may make the window itself taller than the screen.
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, screen: window.innerHeight }));
  expect(sizes.page).toBe(sizes.screen);

  // Opening the folded parts grows the pane's content, not the window.
  await page.getByText("How a long chat plays out").click();
  await page.getByText("Exact numbers").click();
  await page.getByRole("textbox", { name: "Keep loaded for" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const after = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, screen: window.innerHeight }));
  expect(after.page).toBe(after.screen);
});
