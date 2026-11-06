import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { answers, firstMessage, sessionId, sessionsPanel, startStack, youSaid } from "./stack.ts";

const titleButton = (page: Page) => page.getByRole("button", { name: /^Session actions:/ });
const menuItem = (page: Page, name: string) => page.getByRole("menuitem", { name });

test("rename from the title bar", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  model.reply("Done.");
  await firstMessage(page, gateway.url, "hello");
  await expect(answers(page)).toContainText("Done.");
  await titleButton(page).click();
  await menuItem(page, "Rename").click();
  const field = page.getByRole("textbox", { name: "Session title" });
  await field.fill("Release notes");
  await field.press("Enter");
  await expect(page.getByRole("button", { name: "Session actions: Release notes" })).toBeVisible();
  await expect(sessionsPanel(page).getByRole("link", { name: /Release notes/ })).toBeVisible();
  await expect(page).toHaveTitle(/Release notes/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Session actions: Release notes" })).toBeVisible();
});

test("rename from the sidebar row, and Escape cancels", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  model.reply("Done.");
  await firstMessage(page, gateway.url, "hello");
  await expect(answers(page)).toContainText("Done.");
  await titleButton(page).click();
  await menuItem(page, "Rename").click();
  const first = page.getByRole("textbox", { name: "Session title" });
  await first.fill("Release notes");
  await first.press("Enter");
  await expect(sessionsPanel(page).getByRole("link", { name: /Release notes/ })).toBeVisible();

  const row = sessionsPanel(page).getByRole("link", { name: /Release notes/ });
  await row.hover();
  await page.getByRole("button", { name: "Actions for Release notes" }).click();
  await menuItem(page, "Rename").click();
  const field = page.getByRole("textbox", { name: "Rename Release notes" });
  await field.fill("Something else");
  await field.press("Escape");
  await expect(sessionsPanel(page).getByRole("link", { name: /Release notes/ })).toBeVisible();
  await expect(sessionsPanel(page).getByRole("link", { name: /Something else/ })).toHaveCount(0);

  await row.hover();
  await page.getByRole("button", { name: "Actions for Release notes" }).click();
  await menuItem(page, "Rename").click();
  const again = page.getByRole("textbox", { name: "Rename Release notes" });
  await again.fill("Changelog");
  await again.press("Enter");
  await expect(sessionsPanel(page).getByRole("link", { name: /Changelog/ })).toBeVisible();
});

test("fork opens a new session that holds the first answer", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  model.reply("The first answer.");
  const before = await firstMessage(page, gateway.url, "first question");
  await expect(answers(page)).toContainText("The first answer.");
  await titleButton(page).click();
  await menuItem(page, "Fork").click();
  await expect.poll(() => new URL(page.url()).pathname).not.toBe(before);
  expect(new URL(page.url()).pathname).toMatch(/^\/s\/[^/]+$/);
  await expect(sessionsPanel(page).getByRole("link")).toHaveCount(2);
  await expect(sessionsPanel(page).getByText(/fork of/i)).toBeVisible();
  await expect(youSaid(page)).toHaveCount(1);
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page)).toContainText("The first answer.");
});

test("close asks first, Cancel keeps the session, Close removes it", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  model.reply("Done.");
  await firstMessage(page, gateway.url, "hello");
  await expect(answers(page)).toContainText("Done.");
  const path = new URL(page.url()).pathname;

  await titleButton(page).click();
  await menuItem(page, "Close").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Close this session?")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(new URL(page.url()).pathname).toBe(path);
  await expect(sessionsPanel(page).getByRole("link")).toHaveCount(1);

  await titleButton(page).click();
  await menuItem(page, "Close").click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(sessionsPanel(page).getByRole("link")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
});

test("a rename by a second client shows without a reload", async ({ page, rig }) => {
  const { model, gateway, second } = await startStack(rig);
  model.reply("Done.");
  const path = await firstMessage(page, gateway.url, "hello");
  await expect(answers(page)).toContainText("Done.");
  await second.client.renameSession(sessionId(path), "From the terminal");
  await expect(page.getByRole("button", { name: "Session actions: From the terminal" })).toBeVisible();
  await expect(sessionsPanel(page).getByRole("link", { name: /From the terminal/ })).toBeVisible();
});

test("a close by a second client removes the row of a session the page is not viewing", async ({ page, rig }) => {
  const { model, gateway, second, home } = await startStack(rig);
  model.reply("Done.");
  await firstMessage(page, gateway.url, "hello");
  await expect(answers(page)).toContainText("Done.");
  const other = await second.client.createSession({ cwd: home });
  await expect(sessionsPanel(page).getByRole("link")).toHaveCount(2);
  await second.client.closeSession(other.session_id);
  await expect(sessionsPanel(page).getByRole("link")).toHaveCount(1);
});
