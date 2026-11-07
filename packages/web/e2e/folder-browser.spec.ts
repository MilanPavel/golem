import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "./fixtures.ts";
import { answers, send, sessionsPanel, startStack } from "./stack.ts";

test("browse to a folder under home, use it, and the new session runs there", async ({ page, rig }) => {
  // The daemon lists the user's home folder, so the tree is a short-lived folder in it.
  const root = mkdtempSync(path.join(os.homedir(), "golem-e2e-"));
  try {
    mkdirSync(path.join(root, "projects", "alpha", ".git"), { recursive: true });
    mkdirSync(path.join(root, "projects", "beta"));
    const stack = await startStack(rig);
    stack.model.reply("Done.");
    await page.goto(stack.gateway.url);
    await expect(page.getByText("connected", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^Folder:/ }).click();
    await page.getByRole("menuitem", { name: "Choose a folder…" }).click();
    const browser = page.getByRole("dialog", { name: "Choose a folder" });
    await expect(browser).toBeVisible();
    await expect(browser.getByRole("navigation", { name: "Folder path" })).toHaveText("~");

    const filter = browser.getByRole("combobox", { name: "Filter, or type a path" });
    await filter.fill(`~/${path.basename(root)}/projects`);
    await filter.press("Enter");
    await expect(browser.getByRole("option", { name: /^alpha/ })).toContainText("git");
    await expect(browser.getByRole("option", { name: "beta" })).toBeVisible();
    await browser.getByRole("option", { name: /^alpha/ }).click();
    await expect(browser.getByRole("navigation", { name: "Folder path" })).toContainText("alpha");
    await browser.getByRole("button", { name: "Use this folder" }).click();
    await expect(browser).toBeHidden();
    await expect(page.getByRole("button", { name: "Folder: alpha" })).toHaveAttribute(
      "title",
      path.join(root, "projects", "alpha"),
    );

    await send(page, "hello");
    await page.waitForURL(/\/s\/[^/]+$/);
    await expect(answers(page)).toContainText("Done.");
    await expect(sessionsPanel(page).getByText("alpha")).toBeVisible();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a folder outside home cannot be listed, and a typed path there is used as typed", async ({ page, rig }) => {
  const stack = await startStack(rig);
  await page.goto(stack.gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Folder:/ }).click();
  await page.getByRole("menuitem", { name: "Choose a folder…" }).click();
  const browser = page.getByRole("dialog", { name: "Choose a folder" });
  await expect(browser).toBeVisible();
  await expect(browser.getByRole("navigation", { name: "Folder path" })).toHaveText("~");
  await browser.getByRole("combobox", { name: "Filter, or type a path" }).fill("/tmp");
  await browser.getByRole("combobox", { name: "Filter, or type a path" }).press("Enter");
  await expect(browser).toBeHidden();
  await expect(page.getByRole("button", { name: "Folder: tmp" })).toBeVisible();
});
