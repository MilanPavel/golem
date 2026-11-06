import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { answers, composer, firstMessage, send, sessionId, sessionsPanel, startStack } from "./stack.ts";

const KEY = process.platform === "darwin" ? "Meta+K" : "Control+K";

const palette = (page: Page) => page.getByRole("dialog", { name: "Commands" });
const paletteSearch = (page: Page) => palette(page).getByRole("combobox", { name: "Search commands" });
const status = (page: Page) => page.getByRole("status");

test("the palette opens with the key and with the sidebar button, and Escape closes it", async ({ page, rig }) => {
  const { gateway } = await startStack(rig);
  await page.goto(gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.keyboard.press(KEY);
  await expect(paletteSearch(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
  await expect(composer(page)).toBeFocused();

  await page.getByRole("button", { name: /Search or run a command/ }).click();
  await expect(paletteSearch(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
});

test("a palette command runs: times shown, then hidden", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  model.reply("Done.");
  await firstMessage(page, gateway.url, "hello");
  await expect(answers(page)).toContainText("Done.");
  const words: string[] = [];
  for (let run = 0; run < 2; run += 1) {
    await page.keyboard.press(KEY);
    await paletteSearch(page).fill("/time");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeHidden();
    await expect(status(page)).toContainText(/Times (shown|hidden)\./);
    words.push((await status(page).innerText()).trim());
  }
  expect(new Set(words).size).toBe(2);
});

test("a palette command can open another dialog: /model", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  model.reply("Done.");
  await firstMessage(page, gateway.url, "hello");
  await expect(answers(page)).toContainText("Done.");
  await page.keyboard.press(KEY);
  await paletteSearch(page).fill("/model");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Choose a model" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Choose a model" })).toBeHidden();
});

test("slash commands typed in the composer: /title, /fork, and no session", async ({ page, rig }) => {
  const { model, gateway, second } = await startStack(rig);
  await page.goto(gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await send(page, "/fork");
  await expect(status(page)).toContainText("Start a session first: send a message.");

  model.reply("Done.");
  await send(page, "hello");
  await page.waitForURL(/\/s\/[^/]+$/);
  await expect(answers(page)).toContainText("Done.");
  const first = new URL(page.url()).pathname;

  await send(page, "/title Notes from e2e");
  await expect(status(page)).toContainText("Renamed.");
  await expect(page.getByRole("button", { name: "Session actions: Notes from e2e" })).toBeVisible();
  const listed = await second.client.listSessions();
  expect(JSON.stringify(listed)).toContain("Notes from e2e");

  await send(page, "/fork");
  await expect.poll(() => new URL(page.url()).pathname).not.toBe(first);
  await expect(sessionsPanel(page).getByRole("link")).toHaveCount(2);
  expect(sessionId(first)).not.toBe("");
});
