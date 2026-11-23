import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { railConnected, startStack } from "./stack.ts";

const KEPT = "llama3.2:3b";
const STARRED_OUT = "qwen3:8b";

const picker = (page: Page) => page.getByRole("dialog", { name: "Choose a model" });

/** Opens the gateway link (it carries the login), then Settings › Models by the sidebar. */
async function openModels(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(railConnected(page)).toBeVisible();
  await page.getByRole("navigation", { name: "Sidebar rail" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Models", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/models$/);
}

/** The new-chat screen, with the composer's model menu open on "Choose a model". */
async function openMenu(page: Page, url: string): Promise<void> {
  await page.goto(new URL("/", url).href);
  await expect(railConnected(page)).toBeVisible();
  await page.getByRole("button", { name: /^Model: / }).click();
  await expect(picker(page)).toBeVisible();
}

test("a star on the Models page puts a model in the composer's model menu, and taking it off removes it", async ({ page, rig }) => {
  const stack = await startStack(rig, { ollama: { installed: [KEPT, STARRED_OUT] } });
  await openModels(page, stack.gateway.url);

  await page.getByRole("button", { name: /^Ollama, / }).click();
  const star = page.getByRole("button", { name: new RegExp(`^Show .*${STARRED_OUT.split(":")[0]}.* in the model menu`, "i") });
  // Installed models start in the menu.
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "false");

  await openMenu(page, stack.gateway.url);
  await expect(picker(page).getByRole("option", { name: new RegExp(KEPT.replace(".", "\\.")) }).first()).toBeVisible();
  await expect(picker(page).getByRole("option", { name: /qwen3/i })).toHaveCount(0);

  // Star it again: it is back in the menu.
  await page.goto(new URL("/settings/models", stack.gateway.url).href);
  await page.getByRole("button", { name: /^Ollama, / }).click();
  await page.getByRole("button", { name: new RegExp(`^Show .*${STARRED_OUT.split(":")[0]}.* in the model menu`, "i") }).click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await openMenu(page, stack.gateway.url);
  await expect(picker(page).getByRole("option", { name: /qwen3/i }).first()).toBeVisible();
});

test("a hosted provider without a key shows the command to set it up in a terminal", async ({ page, rig }) => {
  const stack = await startStack(rig, { ollama: { installed: [KEPT] } });
  await openModels(page, stack.gateway.url);

  await page.getByRole("button", { name: "Moonshot, set up" }).click();
  const setup = page.getByRole("region", { name: "Set up Moonshot" });
  await expect(setup).toBeVisible();
  await expect(setup).toContainText("golem auth set moonshot");
  await expect(setup).toContainText("This page never sees it.");
  await expect(setup.getByRole("button", { name: /copy/i })).toBeVisible();
});

test("a long model list scrolls on its own: the title and the provider list stay in view", async ({ page, rig }) => {
  const many = Array.from({ length: 30 }, (_, index) => `qwen3:${index + 1}b`);
  const stack = await startStack(rig, { ollama: { installed: many } });
  await page.setViewportSize({ width: 1280, height: 700 });
  await openModels(page, stack.gateway.url);
  await page.getByRole("button", { name: /^Ollama, / }).click();
  const last = page.getByRole("button", { name: /^Show .*qwen3:30b.* in the model menu/i });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Models", level: 2 })).toBeInViewport();
  await expect(page.getByRole("button", { name: /^Ollama, / })).toBeInViewport();
});
