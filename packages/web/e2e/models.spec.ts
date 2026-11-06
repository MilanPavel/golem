import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { answers, firstMessage, startStack, type Stack } from "./stack.ts";

const NAME = "llama3.2:3b";

const chip = (page: Page) => page.getByRole("button", { name: /^Model:/ });
const picker = (page: Page) => page.getByRole("dialog", { name: "Choose a model" });
const search = (page: Page) => picker(page).getByRole("combobox", { name: "Search models" });
const downloadBar = (page: Page) => picker(page).getByRole("progressbar", { name: `Downloading ${NAME}` });

/** A session with one answer, and the model picker open and searched for the stub's model. */
async function openPicker(page: Page, stack: Stack): Promise<void> {
  stack.model.reply("Done.");
  await firstMessage(page, stack.gateway.url, "hello");
  await expect(answers(page)).toContainText("Done.");
  await chip(page).click();
  await expect(picker(page)).toBeVisible();
  await search(page).fill("llama");
}

test("switch the model for this session", async ({ page, rig }) => {
  const stack = await startStack(rig, { ollama: { installed: [NAME] } });
  await openPicker(page, stack);
  await picker(page).getByRole("option", { name: new RegExp(NAME.replace(".", "\\.")) }).first().click();
  await picker(page).getByRole("button", { name: "Use for this session" }).click();
  await expect(picker(page)).toBeHidden();
  await expect(chip(page)).toHaveAccessibleName(/^Model: .*llama3\.2/i);
});

test("a download started by the second client shows in the page, and ends there", async ({ page, rig }) => {
  const stack = await startStack(rig, { ollama: {} });
  await openPicker(page, stack);
  await expect(downloadBar(page)).toHaveCount(0);
  stack.ollama?.holdPulls();
  await stack.second.client.pullModel(NAME);
  await expect(downloadBar(page)).toBeVisible();
  await expect(picker(page).getByRole("button", { name: "Stop download" })).toBeVisible();
  stack.ollama?.releasePulls();
  await expect(downloadBar(page)).toBeHidden();
  await expect(picker(page).getByRole("button", { name: "Use for this session" })).toBeEnabled();
  expect(stack.ollama?.pulls).toEqual([NAME]);
});

test("a download started from the page asks first, then shows its bar", async ({ page, rig }) => {
  const stack = await startStack(rig, { ollama: {} });
  await openPicker(page, stack);
  stack.ollama?.holdPulls();
  await picker(page).getByRole("button", { name: "Download", exact: true }).click();
  const confirm = picker(page).getByRole("group", { name: "Confirm" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Download", exact: true }).click();
  await expect(downloadBar(page)).toBeVisible();
  stack.ollama?.releasePulls();
  // A download from the page ends by using the model for this session: the row is now in use.
  await expect(downloadBar(page)).toBeHidden();
  await expect(picker(page).getByRole("button", { name: "In use" })).toBeVisible();
  expect(stack.ollama?.pulls).toEqual([NAME]);
});
