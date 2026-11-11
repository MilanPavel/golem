import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

import { axeViolations } from "./axe.ts";
import { expect, test } from "./fixtures.ts";
import { answers, composer, setTheme, startStack } from "./stack.ts";

/** The gateway link carries the login, so open it first, then the session. */
async function openSession(page: Page, url: string, sessionId: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.goto(new URL(`/s/${sessionId}`, url).href);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
}

test("a run that used a tool shows as a run, a model call, and a tool call in the inspector, and on the trace page", async ({ page, rig }) => {
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

  // The Inspect button opens the trace beside the chat, and the address says so.
  const inspect = page.getByRole("button", { name: "Inspect" });
  await expect(inspect).toHaveAttribute("aria-pressed", "false");
  await inspect.click();
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}\\?inspect$`));
  await expect(inspect).toHaveAttribute("aria-pressed", "true");
  const inspector = page.getByRole("complementary", { name: "Trace inspector" });
  await expect(inspector.getByRole("treeitem", { name: /read_file/ })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Resize the inspector" })).toBeVisible();
  await expect(composer(page)).toBeVisible();
  await inspector.getByRole("treeitem", { name: /read_file/ }).click();
  await expect(page).toHaveURL(/\?inspect=/);
  await page.reload();
  await expect(inspector.getByRole("treeitem", { name: /read_file/ })).toHaveAttribute("aria-selected", "true");
  await inspector.getByRole("button", { name: "Close inspector" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}$`));
  await expect(inspector).toHaveCount(0);

  // The full page opens from the panel.
  await inspect.click();
  await inspector.getByRole("link", { name: "Open full ↗" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}/trace$`));

  const tree = page.getByRole("tree", { name: "Trace" });
  await expect(tree.getByRole("treeitem", { name: /Run · what is in notes\?/ })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /model 1/ })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /model 2/ })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /read_file/ })).toBeVisible();
  await expect(page.getByText(/^1 run · /)).toBeVisible();
  // The session's top bar is the chat's. Its header sits inside main, so it is no banner landmark.
  await expect(page.getByRole("button", { name: /^Model: / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Session actions/ })).toBeVisible();
  // An open drawer has its own "Hide details" button too; the toggle comes first.
  await expect(page.getByRole("button", { name: /^(Show|Hide) details$/ }).first()).toBeVisible();

  // Selecting a span puts it in the address, so a link opens the same one.
  await tree.getByRole("treeitem", { name: /read_file/ }).click();
  await expect(page).toHaveURL(/\?span=/);
  await page.reload();
  await expect(tree.getByRole("treeitem", { name: /read_file/ })).toHaveAttribute("aria-selected", "true");

  // The tool's detail: its args and its result.
  const detail = page.getByRole("region", { name: "Span detail" });
  await expect(detail.getByRole("heading", { name: /read_file/ })).toBeVisible();
  await expect(detail.getByText("notes.txt")).toBeVisible();
  await detail.getByRole("tab", { name: "Result" }).click();
  await expect(detail.getByText("the answer is 42")).toBeVisible();
  await expect(detail.getByRole("tab", { name: "Approval" })).toHaveCount(0);

  // The model call's detail: the user's message is in its context, and the call's reply is in Reply.
  await tree.getByRole("treeitem", { name: /model 1/ }).click();
  await expect(detail.getByRole("tab", { name: "Context" })).toHaveAttribute("aria-selected", "true");
  await expect(detail.getByRole("list", { name: "Messages" }).getByText("what is in notes?")).toBeVisible();
  await detail.getByRole("tab", { name: "Reply" }).click();
  await expect(detail.getByText("→ read_file(path=\"notes.txt\")")).toBeVisible();
  await tree.getByRole("treeitem", { name: /read_file/ }).click();

  // The keyboard moves the selection.
  await tree.getByRole("treeitem", { name: /read_file/ }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(tree.getByRole("treeitem", { name: /model 1/ })).toHaveAttribute("aria-selected", "true");

  expect(await axeViolations(page)).toEqual([]);
  await setTheme(page, "kiln");
  expect(await axeViolations(page)).toEqual([]);
  await setTheme(page, "slip");

  await page.getByRole("link", { name: "Back to chat" }).click();
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
