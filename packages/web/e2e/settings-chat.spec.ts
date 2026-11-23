import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { answers, composer, railConnected, send, startStack } from "./stack.ts";

/** Opens the gateway link (it carries the login), then a Settings page by the sidebar. */
async function openSettings(page: Page, url: string, section: string): Promise<void> {
  await page.goto(url);
  await expect(railConnected(page)).toBeVisible();
  await page.getByRole("navigation", { name: "Sidebar rail" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: section, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/settings/${section.toLowerCase()}$`));
}

/** The system prompt of a request to the fake model, as text. */
function systemPrompt(request: unknown): string {
  const messages = (request as { messages?: { role: string; content: unknown }[] }).messages ?? [];
  const system = messages.find((message) => message.role === "system");
  return typeof system?.content === "string" ? system.content : JSON.stringify(system?.content ?? "");
}

const LINE = "Answer in two short sentences, in plain words.";

test("an instruction line shows in what the model reads, and reaches the model in a new chat", async ({ page, rig }) => {
  const stack = await startStack(rig);
  stack.model.reply("Done.");
  await openSettings(page, stack.gateway.url, "Chat");

  await page.getByRole("button", { name: "+ Write a line" }).click();
  const line = page.getByRole("textbox", { name: "Line 1" });
  await line.fill(LINE);
  await line.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  const reads = page.getByRole("group", { name: "What the model reads" });
  await reads.getByRole("button", { name: "See all of it" }).click();
  await reads.getByRole("button", { name: /^Your instructions/ }).click();
  await expect(reads.getByLabel("Your instructions, as the model reads it")).toContainText(LINE);

  // A new chat starts from the saved line.
  await page.goto(stack.gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await send(page, "hello");
  await page.waitForURL(/\/s\/[^/]+$/);
  await expect(answers(page)).toContainText("Done.");
  expect(stack.model.requests).toHaveLength(1);
  expect(systemPrompt(stack.model.requests[0])).toContain(LINE);
});

test("Start with a plan makes a new chat start in plan first", async ({ page, rig }) => {
  const stack = await startStack(rig);
  stack.model.reply("Here is the plan.");
  await openSettings(page, stack.gateway.url, "Chat");

  const plan = page.getByRole("switch", { name: "Start with a plan" });
  await expect(plan).toHaveAttribute("aria-checked", "false");
  await plan.click();
  await expect(plan).toHaveAttribute("aria-checked", "true");

  await page.goto(stack.gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await send(page, "plan my week");
  await page.waitForURL(/\/s\/[^/]+$/);
  await expect(answers(page)).toContainText("Here is the plan.");
  await expect(page.getByRole("button", { name: /^Permission mode:.*Plan first is on/ })).toBeVisible();
  expect(systemPrompt(stack.model.requests[0])).toContain("Plan first is on");
});

test("Steps and Thinking on the Chat page change how the transcript shows a turn", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const dir = realpathSync(rig.home());
  writeFileSync(path.join(dir, "notes.txt"), "the answer is 42\n");
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: dir });
  const sessionUrl = new URL(`/s/${sessionId}`, stack.gateway.url).href;
  stack.model.toolCall("read_file", { path: "notes.txt" });
  stack.model.reply("<think>Let me look at the notes.</think>It says 42.");

  // Quiet steps, thinking open.
  await openSettings(page, stack.gateway.url, "Chat");
  await page.getByRole("radiogroup", { name: "Steps" }).getByRole("radio", { name: "Quiet" }).click();
  await page.getByRole("radiogroup", { name: "Thinking" }).getByRole("radio", { name: "Open" }).click();
  await page.goto(sessionUrl);
  await expect(railConnected(page)).toBeVisible();
  await send(page, "what is in notes?");
  await expect(answers(page).last()).toContainText("It says 42.");
  const steps = page.locator("[data-activity] button").first();
  await expect(steps).toHaveText(/1 step$/);
  await expect(steps).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("region", { name: "Thinking" })).toContainText("Let me look at the notes.");

  // Verbose steps, thinking collapsed: the same turn follows.
  await page.goto(new URL("/settings/chat", stack.gateway.url).href);
  await page.getByRole("radiogroup", { name: "Steps" }).getByRole("radio", { name: "Verbose" }).click();
  await page.getByRole("radiogroup", { name: "Thinking" }).getByRole("radio", { name: "Collapsed" }).click();
  await page.goto(sessionUrl);
  await expect(composer(page)).toBeVisible();
  await expect(page.locator("[data-activity] button").first()).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "Thinking" })).toHaveCount(0);
  await expect(page.locator("[data-thinking] button")).toHaveAttribute("aria-expanded", "false");
});

test("an instruction line moves the count and the reads line, and See all of it lists the parts", async ({ page, rig }) => {
  const stack = await startStack(rig);
  await openSettings(page, stack.gateway.url, "Chat");
  const reads = page.getByRole("group", { name: "What the model reads" });
  await expect(reads).toContainText("yours are 0");
  await expect(page.getByText("No instructions. The model answers in its own style.")).toBeVisible();

  await page.getByRole("button", { name: "+ Write a line" }).click();
  const line = page.getByRole("textbox", { name: "Line 1" });
  await line.fill(LINE);
  await line.press("Enter");
  await expect(page.getByText(/^1 line · about [1-9]\d* tokens in every chat$/)).toBeVisible();
  await expect(reads).not.toContainText("yours are 0");

  await reads.getByRole("button", { name: "See all of it" }).click();
  const parts = reads.getByRole("list", { name: "Parts" });
  await expect(parts.getByRole("button").first()).toHaveText(/^Your instructions/);
  await expect(reads.getByRole("button", { name: "Hide" })).toBeVisible();
});

test("the mode track follows the stop, and Autopilot asks first and then saves", async ({ page, rig }) => {
  const stack = await startStack(rig);
  await openSettings(page, stack.gateway.url, "Chat");
  const mode = page.getByRole("radiogroup", { name: "Mode" });
  const zones = (state: string) => mode.locator(`[data-zone="${state}"]`);

  await expect(mode.getByRole("radio", { name: "Balanced" })).toHaveAttribute("aria-checked", "true");
  await expect(zones("alone")).toHaveCount(2);
  await expect(zones("asks")).toHaveCount(1);

  await mode.getByRole("radio", { name: "Careful" }).click();
  await expect(mode.getByRole("radio", { name: "Careful" })).toHaveAttribute("aria-checked", "true");
  await expect(zones("alone")).toHaveCount(1);
  await expect(zones("asks")).toHaveCount(2);
  await expect(zones("lock")).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: /^Saved to / })).toBeVisible();

  // Autopilot asks in place first, and Cancel keeps the old stop.
  await mode.getByRole("radio", { name: "Autopilot" }).click();
  const ask = page.getByRole("group", { name: "Use Autopilot?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(mode.getByRole("radio", { name: "Careful" })).toHaveAttribute("aria-checked", "true");

  await mode.getByRole("radio", { name: "Autopilot" }).click();
  await ask.getByRole("button", { name: "Use Autopilot" }).click();
  await expect(mode.getByRole("radio", { name: "Autopilot" })).toHaveAttribute("aria-checked", "true");
  await expect(zones("alone")).toHaveCount(3);
  await expect(page.getByRole("status").filter({ hasText: /^Saved to / })).toBeVisible();

  // It was saved: a new load shows it.
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Autopilot" })).toHaveAttribute("aria-checked", "true");
});

test("the sample answer follows Steps and Thinking, and a footer part can be turned off", async ({ page, rig }) => {
  const stack = await startStack(rig);
  await openSettings(page, stack.gateway.url, "Chat");
  const shows = page.getByRole("list", { name: "What you see" });
  const steps = shows.locator("[data-activity] button").first();
  const thinking = shows.locator("[data-thinking] button");

  await shows.getByRole("radiogroup", { name: "Steps" }).getByRole("radio", { name: "Verbose" }).click();
  await shows.getByRole("radiogroup", { name: "Thinking" }).getByRole("radio", { name: "Open" }).click();
  await expect(steps).toHaveAttribute("aria-expanded", "true");
  await expect(shows.getByRole("region", { name: "Thinking" })).toBeVisible();

  await shows.getByRole("radiogroup", { name: "Steps" }).getByRole("radio", { name: "Quiet" }).click();
  await shows.getByRole("radiogroup", { name: "Thinking" }).getByRole("radio", { name: "Collapsed" }).click();
  await expect(steps).toHaveAttribute("aria-expanded", "false");
  await expect(shows.getByRole("region", { name: "Thinking" })).toHaveCount(0);
  await expect(thinking).toHaveAttribute("aria-expanded", "false");

  await shows.getByRole("radiogroup", { name: "Thinking" }).getByRole("radio", { name: "Hidden" }).click();
  await expect(shows.getByText("thinking is hidden")).toBeVisible();

  const footer = shows.locator("[data-footer-line]");
  await expect(footer).toContainText("local");
  await shows.getByRole("group", { name: "Parts of the line under each answer" }).getByRole("button", { name: "Local or hosted" }).click();
  await expect(footer).not.toContainText("local");
});
