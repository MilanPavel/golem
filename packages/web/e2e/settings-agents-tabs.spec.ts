import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { railConnected, startStack } from "./stack.ts";

/** Opens the gateway link (it carries the login), then Settings › Agents. Nothing here starts a measurement. */
async function openAgents(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(railConnected(page)).toBeVisible();
  await page.getByRole("navigation", { name: "Sidebar rail" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Agents", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/agents$/);
}

test("Settings > Agents has three tabs; Rules shows the first guess and Measure shows the arms", async ({ page, rig }) => {
  const stack = await startStack(rig);
  await openAgents(page, stack.gateway.url);

  const tabs = page.getByRole("tablist", { name: "Parts of Agents" });
  await expect(tabs.getByRole("tab")).toHaveText(["Agents", "Rules", "Measure"]);

  await tabs.getByRole("tab", { name: "Rules" }).click();
  await expect(page.locator("[data-reason]")).toHaveCount(3);
  await expect(page.locator("[data-reasons-foot]")).toContainText("FIRST GUESS");

  await tabs.getByRole("tab", { name: /^Measure/ }).click();
  await expect(page.getByRole("list", { name: "Arms of the measurement" })).toBeVisible();
  // Start, stop, resume and apply need a model, so they are covered by the daemon test over the socket (scripted
  // drivers) and by the page tests with a scripted client, not here.
});
