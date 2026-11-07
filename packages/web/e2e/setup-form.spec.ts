import type { Page } from "@playwright/test";

import { axeViolations } from "./axe.ts";
import { expect, test } from "./fixtures.ts";
import { setTheme, startStack } from "./stack.ts";

const NAME = "llama3.2:3b";

const cards = (page: Page) => page.getByRole("list", { name: "Setup" });
const card = (page: Page, name: string) => cards(page).getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
const picker = (page: Page) => page.getByRole("dialog", { name: "Choose a model" });

async function open(page: Page, url: string): Promise<void> {
  // The gateway's link carries a token, so the page is reached by it and then by the sidebar.
  await page.goto(url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.getByRole("complementary", { name: "Sessions" }).getByRole("button", { name: /^Settings/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(cards(page)).toBeVisible();
}

test("Settings → Setup has a card for each part, and no dialog button", async ({ page, rig }) => {
  const { gateway } = await startStack(rig, { ollama: { installed: [NAME] } });
  await open(page, gateway.url);
  await expect(card(page, "Service")).toBeVisible();
  await expect(card(page, "legacy")).toContainText("no key needed");
  await expect(card(page, "Model")).toBeVisible();
  await expect(card(page, "Disk")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open setup" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run setup again" })).toBeVisible();
});

test("Change… then Make default: the Model card shows the new default, and no session was touched", async ({ page, rig }) => {
  const { gateway, second } = await startStack(rig, { ollama: { installed: [NAME] } });
  await open(page, gateway.url);
  await card(page, "Model").getByRole("button", { name: "Change…" }).click();
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).getByText(/New sessions use /)).toBeVisible();
  await picker(page).getByRole("combobox", { name: "Search models" }).fill("llama");
  await picker(page).getByRole("option", { name: /llama3\.2:3b/ }).first().click();
  await expect(picker(page).getByRole("button", { name: /^Use for/ })).toHaveCount(0);
  await picker(page).getByRole("button", { name: "Make default" }).click();
  await expect(picker(page).getByRole("button", { name: "Default" })).toBeVisible();
  // Esc clears the search first, then closes.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(picker(page)).toBeHidden({ timeout: 500 });
  }).toPass({ timeout: 5_000 });
  await expect(card(page, "Model")).toContainText(/llama3\.2/i);
  expect((await second.client.listSessions()).sessions).toHaveLength(0);
});

test("API keys are on the page, and the page has no key field", async ({ page, rig }) => {
  const { gateway } = await startStack(rig, { ollama: { installed: [NAME] } });
  await open(page, gateway.url);
  // Which providers have a key depends on the keys in the environment the daemon runs in, so the
  // saved marks and the command are checked in the component's tests.
  await expect(page.getByRole("group", { name: "API keys" })).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
});

for (const [theme, label] of [
  ["slip", "parchment"],
  ["kiln", "kiln"],
] as const) {
  test(`no serious accessibility violations on Settings → Setup in the ${label} theme`, async ({ page, rig }) => {
    const { gateway } = await startStack(rig, { ollama: { installed: [NAME] } });
    await open(page, gateway.url);
    await setTheme(page, theme);
    expect(await axeViolations(page), "setup form").toEqual([]);
  });
}
