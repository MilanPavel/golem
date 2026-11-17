import { realpathSync } from "node:fs";

import { expect, test } from "./fixtures.ts";
import { railConnected, startStack } from "./stack.ts";

const rail = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Sidebar rail" });

test("a narrow window hides the rail behind the ☰, and a session pick closes the sidebar", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: realpathSync(rig.home()) });

  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(stack.gateway.url);
  await expect(page.getByRole("button", { name: "Open sidebar" })).toBeVisible();
  await expect(rail(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(rail(page)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Sessions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rail(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open sidebar" })).toBeFocused();

  await page.getByRole("button", { name: "Open sidebar" }).click();
  await page.getByRole("complementary", { name: "Sessions" }).getByRole("link").first().click();
  await page.waitForURL(new RegExp(`/s/${sessionId}$`));
  await expect(rail(page)).toHaveCount(0);
});

test("a medium window shows the rail, and the panel floats over the page on demand", async ({ page, rig }) => {
  const stack = await startStack(rig);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(stack.gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Sessions" })).toHaveCount(0);

  await rail(page).getByRole("button", { name: "Sessions" }).click();
  await expect(page.getByRole("complementary", { name: "Sessions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Sessions" })).toHaveCount(0);
});
