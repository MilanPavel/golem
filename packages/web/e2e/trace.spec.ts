import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

import { axeViolations } from "./axe.ts";
import { expect, test } from "./fixtures.ts";
import { answers, composer, startStack } from "./stack.ts";

/** The gateway link carries the login, so open it first, then the session. */
async function openSession(page: Page, url: string, sessionId: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.goto(new URL(`/s/${sessionId}`, url).href);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
}

test("a run that used a tool shows as a run, a model call, and a tool call on the trace page", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const dir = realpathSync(rig.home());
  writeFileSync(path.join(dir, "notes.txt"), "the answer is 42\n");
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: dir });
  stack.model.toolCall("read_file", { path: "notes.txt" });
  stack.model.reply("It says 42.");

  await openSession(page, stack.gateway.url, sessionId);
  await composer(page).fill("what is in notes?");
  await composer(page).press("Enter");
  await expect(answers(page).last()).toContainText("It says 42.");

  // The chat's switch opens the trace.
  const view = page.getByRole("group", { name: "View" });
  await expect(view.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true");
  await view.getByRole("button", { name: "Trace" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}/trace$`));

  const tree = page.getByRole("tree", { name: "Trace" });
  await expect(tree.getByRole("treeitem", { name: /Run · what is in notes\?/ })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /model 1/ })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /model 2/ })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /read_file/ })).toBeVisible();
  await expect(page.getByText(/^1 run · /)).toBeVisible();

  // Selecting a span puts it in the address, so a link opens the same one.
  await tree.getByRole("treeitem", { name: /read_file/ }).click();
  await expect(page).toHaveURL(/\?span=/);
  await page.reload();
  await expect(tree.getByRole("treeitem", { name: /read_file/ })).toHaveAttribute("aria-selected", "true");

  // The keyboard moves the selection.
  await tree.getByRole("treeitem", { name: /read_file/ }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(tree.getByRole("treeitem", { name: /model 1/ })).toHaveAttribute("aria-selected", "true");

  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Chat" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}$`));
});

test("the palette's Trace row opens the trace of the open session", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: realpathSync(rig.home()) });
  await openSession(page, stack.gateway.url, sessionId);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("combobox", { name: "Search commands" }).fill("trace");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}/trace$`));
  await expect(page.getByText("Nothing to trace yet. Send a message first.")).toBeVisible();
});
