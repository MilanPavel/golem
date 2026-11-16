import { realpathSync } from "node:fs";
import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { railConnected, startStack } from "./stack.ts";

const bottom = async (el: Locator): Promise<number> => el.evaluate((node) => node.getBoundingClientRect().bottom);

test("the line under the top bar meets the line under a panel's header", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: realpathSync(rig.home()) });
  await page.goto(stack.gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await page.goto(new URL(`/s/${sessionId}`, stack.gateway.url).href);
  await expect(railConnected(page)).toBeVisible();

  const topBar = page.locator("main header").first();

  await page.getByRole("button", { name: /^(Show|Hide) details$/ }).first().waitFor();
  if ((await page.getByRole("complementary", { name: "Details" }).count()) === 0) {
    await page.getByRole("button", { name: /^Show details$/ }).first().click();
  }
  const tabs = page.getByRole("complementary", { name: "Details" }).getByRole("tablist").locator("xpath=..");
  await expect(tabs).toBeVisible();
  expect(Math.abs((await bottom(topBar)) - (await bottom(tabs)))).toBeLessThanOrEqual(0.5);

  await page.getByRole("button", { name: /^Hide details$/ }).first().click();
  await page.getByRole("button", { name: "Inspect" }).click();
  const header = page.getByRole("complementary", { name: "Trace inspector" }).getByRole("heading", { name: "Trace" }).locator("xpath=..");
  await expect(header).toBeVisible();
  expect(Math.abs((await bottom(topBar)) - (await bottom(header)))).toBeLessThanOrEqual(0.5);
});
