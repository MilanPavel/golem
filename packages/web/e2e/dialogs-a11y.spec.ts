import type { Locator, Page } from "@playwright/test";

import { axeViolations } from "./axe.ts";
import { expect, test } from "./fixtures.ts";
import { answers, firstMessage, send, setTheme, startStack } from "./stack.ts";

const KEY = process.platform === "darwin" ? "Meta+K" : "Control+K";
const INSTALLED = "llama3.2:3b";
const PULLING = "qwen3:8b";

const THEMES = [
  ["slip", "parchment"],
  ["kiln", "kiln"],
] as const;

async function themeIs(page: Page, theme: string): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(theme);
}

/** Waits for the dialog's open animation to end, so axe measures the colours it settles on. */
async function settled(dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  // Looping animations (a spinner) never finish, so only the ones that end are awaited.
  await dialog.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ).then(() => undefined),
  );
}

async function axe(page: Page, dialog: Locator, what: string): Promise<void> {
  await settled(dialog);
  expect(await axeViolations(page), what).toEqual([]);
}

for (const [theme, label] of THEMES) {
  test(`no serious accessibility violations on the palette in the ${label} theme`, async ({ page, rig }) => {
    const { model, gateway } = await startStack(rig);
    await page.goto(gateway.url);
    await expect(page.getByText("connected", { exact: true })).toBeVisible();
    await setTheme(page, theme);
    await page.keyboard.press(KEY);
    await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
    await themeIs(page, theme);
    await axe(page, page.getByRole("dialog", { name: "Commands" }), "palette on the home screen");
    await page.keyboard.press("Escape");

    model.reply("Done.");
    await send(page, "hello");
    await page.waitForURL(/\/s\/[^/]+$/);
    await expect(answers(page)).toContainText("Done.");
    await page.keyboard.press(KEY);
    await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
    await axe(page, page.getByRole("dialog", { name: "Commands" }), "palette on a session screen");
  });

  test(`no serious accessibility violations on the model picker in the ${label} theme`, async ({ page, rig }) => {
    const stack = await startStack(rig, { ollama: { installed: [INSTALLED] } });
    stack.model.reply("Done.");
    await firstMessage(page, stack.gateway.url, "hello");
    await expect(answers(page)).toContainText("Done.");
    await setTheme(page, theme);
    stack.ollama?.holdPulls();
    await page.getByRole("button", { name: /^Model:/ }).click();
    const picker = page.getByRole("dialog", { name: "Choose a model" });
    await expect(picker).toBeVisible();
    await stack.second.client.pullModel(PULLING);
    await expect(picker.getByRole("progressbar", { name: `Downloading ${PULLING}` })).toBeVisible();
    await themeIs(page, theme);
    await axe(page, picker, "model picker: ready, not downloaded, and downloading rows");
    stack.ollama?.releasePulls();
  });

  test(`no serious accessibility violations on /welcome in the ${label} theme`, async ({ page, rig }) => {
    const { gateway, ollama } = await startStack(rig, { ollama: {}, chat: false });
    await page.goto(gateway.url);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to golem" })).toBeVisible();
    await setTheme(page, theme);
    await themeIs(page, theme);
    expect(await axeViolations(page), "welcome on Engine").toEqual([]);

    ollama?.holdPulls();
    await page.getByRole("button", { name: /On this Mac/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Pick a model" })).toBeVisible();
    expect(await axeViolations(page), "welcome on Model").toEqual([]);
    ollama?.releasePulls();
  });
}
