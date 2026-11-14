import type { Page } from "@playwright/test";

import { axeViolations } from "./axe.ts";
import { expect, test } from "./fixtures.ts";
import { setTheme, startStack } from "./stack.ts";

const NAME = "llama3.2:3b";

async function open(page: Page, url: string): Promise<void> {
  // The gateway's link carries a token, so the page is reached by it and then by the sidebar.
  await page.goto(url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.getByRole("complementary", { name: "Sessions" }).getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "MCP servers" }).click();
  await expect(page).toHaveURL(/\/settings\/mcp$/);
}

test("Settings → MCP servers has Installed, Catalog and Import tabs, and Add and Import are no longer buttons of the list", async ({ page, rig }) => {
  const { gateway } = await startStack(rig, { ollama: { installed: [NAME] } });
  await open(page, gateway.url);
  const tabs = page.getByRole("tablist", { name: "MCP servers" });
  await expect(tabs.getByRole("tab", { name: "Installed" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab", { name: "Catalog" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Import" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a server" })).toHaveCount(0);
});

test("the Catalog tab has a card per server with its mark, and Another server last", async ({ page, rig }) => {
  const { gateway } = await startStack(rig, { ollama: { installed: [NAME] } });
  await open(page, gateway.url);
  await page.getByRole("tab", { name: "Catalog" }).click();
  const panel = page.getByRole("tabpanel", { name: "Catalog" });
  await expect(panel.getByRole("heading", { name: "GitHub" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Playwright" })).toBeVisible();
  await expect(panel.locator("li").filter({ has: page.getByRole("heading", { name: "GitHub" }) }).locator("svg")).toHaveCount(1);
  await expect(panel.getByRole("listitem").last()).toContainText("Another server");
  await panel.getByRole("button", { name: "Add another server" }).click();
  await expect(page.getByRole("dialog", { name: "Add another server" })).toBeVisible();
});

test("the Import tab starts with nothing picked, and is clean for axe in both themes", async ({ page, rig }) => {
  const { gateway } = await startStack(rig, { ollama: { installed: [NAME] } });
  await open(page, gateway.url);
  await page.getByRole("tab", { name: "Import" }).click();
  const panel = page.getByRole("tabpanel", { name: "Import" });
  await expect(panel.getByText("0 selected")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(0);
  for (const theme of ["slip", "kiln"] as const) {
    await setTheme(page, theme);
    expect(await axeViolations(page)).toEqual([]);
  }
});
