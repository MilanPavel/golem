import { realpathSync } from "node:fs";

import { expect, test } from "./fixtures.ts";
import { railConnected, startStack } from "./stack.ts";

test("the composer's row stays one line at every width, and its model, folder and mode stay reachable", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: realpathSync(rig.home()) });
  await page.goto(stack.gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await page.goto(new URL(`/s/${sessionId}`, stack.gateway.url).href);
  await expect(railConnected(page)).toBeVisible();

  const row = page.locator("[data-composer-bar]");
  await expect(row).toBeVisible();
  const heights: number[] = [];
  for (const width of [1280, 900, 700, 560, 460, 380, 320]) {
    await page.setViewportSize({ width, height: 800 });
    // Every chip is on the first line of the row, and the row is as tall as its tallest chip: no wrap.
    const tops = await row.locator("button, [title]").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    const box = await row.boundingBox();
    heights.push(box?.height ?? 0);
    expect(Math.max(...tops) - Math.min(...tops), `width ${width}`).toBeLessThanOrEqual(4);
    expect(box?.height ?? 0, `width ${width}`).toBeLessThanOrEqual(40);
    await expect(row.getByRole("button", { name: /^Model:/ })).toBeVisible();
    await expect(row.getByRole("button", { name: /^Permission mode:/ })).toBeVisible();
    await expect(row.getByRole("button", { name: "Send" })).toBeVisible();
  }
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
});
