import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { answers, composer, send, startStack } from "./stack.ts";

/** A fresh home: no model chosen, and a stub Ollama with nothing installed. */
const FRESH = { ollama: {}, chat: false } as const;

const here = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search;

/** Engine to Tools on /welcome: On this Mac, pick Llama 3.2 3B, download it, and skip the tools. */
async function throughToReady(page: Page): Promise<void> {
  await page.getByRole("button", { name: /On this Mac/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Pick a model" })).toBeVisible();
  await page.getByRole("option", { name: /Llama 3\.2 3B/ }).click();
  await page.getByRole("button", { name: "Download and continue" }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "golem is ready." })).toBeVisible();
}

test("a fresh home opens /welcome with no dialog, and a first send works after Ready", async ({ page, rig }) => {
  const { gateway, model, ollama } = await startStack(rig, FRESH);
  await page.goto(gateway.url);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to golem" })).toBeVisible();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("dialog", { name: "Setup" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Setup steps" })).toBeVisible();

  await throughToReady(page);
  expect(ollama?.pulls).toEqual(["llama3.2:3b"]);
  await page.getByRole("button", { name: "Start chatting" }).click();
  await expect(page).toHaveURL(/\/$/);

  await send(page, "hello");
  await expect(answers(page)).toContainText("The stub answers.");
  expect(ollama?.requests).toContain("POST /api/chat");
  expect(model.requests).toHaveLength(0);
});

test("Start chatting while the model downloads: a send waits for it and is answered once it lands", async ({ page, rig }) => {
  const { gateway, model, ollama } = await startStack(rig, FRESH);
  ollama?.holdPulls();
  await page.goto(gateway.url);
  await page.getByRole("button", { name: /On this Mac/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("option", { name: /Llama 3\.2 3B/ }).click();
  await page.getByRole("button", { name: "Download and continue" }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Almost ready." })).toBeVisible();
  await expect(page.getByText("llama3.2:3b is still downloading. Start a chat now and golem answers once it's there, or wait here.")).toBeVisible();
  await page.getByRole("button", { name: "Start chatting" }).click();
  await expect(page).toHaveURL(/\/$/);

  await send(page, "hello");
  await expect(page.getByRole("status").filter({ hasText: "waiting for llama3.2:3b" })).toBeVisible();
  expect(here(page)).not.toContain("/welcome");
  expect(ollama?.requests).not.toContain("POST /api/chat");

  ollama?.releasePulls();
  await expect(answers(page)).toContainText("The stub answers.");
  expect(ollama?.requests).toContain("POST /api/chat");
  expect(model.requests).toHaveLength(0);
});

test("a send with no model goes to /welcome?from=send, and Ready comes back to the draft with nothing sent", async ({ page, rig }) => {
  const { gateway, model, ollama } = await startStack(rig, FRESH);
  await page.goto(gateway.url);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to golem" })).toBeVisible();
  await page.getByRole("button", { name: "Later" }).click();
  await expect(page).toHaveURL(/\/$/);

  await send(page, "my draft");
  await expect.poll(() => here(page)).toBe("/welcome?from=send");
  expect(model.requests).toHaveLength(0);

  await throughToReady(page);
  await page.getByRole("button", { name: "Back to your message" }).click();
  await expect(composer(page)).toHaveValue("my draft");
  expect(model.requests).toHaveLength(0);
  expect(ollama?.pulls).toEqual(["llama3.2:3b"]);
});

test("/setup opens Settings → Setup, whose Run setup again goes to /welcome", async ({ page, rig }) => {
  const { gateway } = await startStack(rig, { ollama: { installed: ["llama3.2:3b"] } });
  await page.goto(gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await send(page, "/setup");
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("button", { name: "Run setup again" }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("dialog", { name: "Setup" })).toHaveCount(0);
});
