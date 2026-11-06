import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { send, startStack } from "./stack.ts";

const setup = (page: Page) => page.getByRole("dialog", { name: "Setup" });
const choice = (page: Page, name: string | RegExp) => setup(page).getByRole("group", { name: "Choices" }).getByRole("button", { name });

/** A fresh home: no model chosen, and a stub Ollama with nothing installed. */
const FRESH = { ollama: {}, chat: false } as const;

test("the setup window opens at the start, on Engine, with its steps", async ({ page, rig }) => {
  const { gateway } = await startStack(rig, FRESH);
  await page.goto(gateway.url);
  await expect(setup(page)).toBeVisible();
  await expect(setup(page).getByRole("list", { name: "Setup steps" })).toBeVisible();
  await expect(setup(page).getByText(/^Step \d\/\d/)).toBeVisible();
  await expect(setup(page).getByText("Where should golem think?")).toBeVisible();
});

test("On this Mac reaches a model on a fresh home, with a download in between", async ({ page, rig }) => {
  const { gateway, model, ollama } = await startStack(rig, FRESH);
  ollama?.holdPulls();
  await page.goto(gateway.url);
  await expect(setup(page)).toBeVisible();
  await choice(page, /On this Mac/).click();
  await expect(setup(page).getByText(/Pick a model/)).toBeVisible();
  await choice(page, /Llama 3\.2 3B/).click();
  await expect(setup(page).getByRole("progressbar", { name: /^Downloading / })).toBeVisible();
  ollama?.releasePulls();
  await expect(setup(page).getByText("golem is ready")).toBeVisible();
  await setup(page).getByRole("button", { name: "Start chatting" }).click();
  await expect(setup(page)).toBeHidden();
  expect(ollama?.pulls).toEqual(["llama3.2:3b"]);
  expect(model.requests).toHaveLength(0);
});

test("the window can be closed, and /setup opens the overview again", async ({ page, rig }) => {
  const { gateway } = await startStack(rig, FRESH);
  await page.goto(gateway.url);
  await expect(setup(page)).toBeVisible();
  await setup(page).getByRole("button", { name: "Close setup" }).click();
  await expect(setup(page)).toBeHidden();
  await send(page, "/setup");
  await expect(setup(page)).toBeVisible();
  await expect(setup(page).getByText("What is set up, and what is not.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(setup(page)).toBeHidden();
});

test("nothing real is reached: no model call, and only the stub's own paths", async ({ page, rig }) => {
  const { gateway, model, ollama } = await startStack(rig, FRESH);
  await page.goto(gateway.url);
  await expect(setup(page)).toBeVisible();
  await choice(page, /On this Mac/).click();
  await expect(setup(page).getByText(/Pick a model/)).toBeVisible();
  expect(model.requests).toHaveLength(0);
  expect(ollama?.pulls).toEqual([]);
  const paths = new Set((ollama?.requests ?? []).map((line) => line.split(" ")[1]));
  for (const path of paths) expect(["/api/tags", "/api/show", "/api/pull", "/api/delete"]).toContain(path);
});
