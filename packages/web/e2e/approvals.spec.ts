import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

import { startFakeModel, type FakeModel } from "./fake-model.ts";
import { axeViolations } from "./axe.ts";
import { expect, test } from "./fixtures.ts";
import {
  startDaemon,
  startGateway,
  startSecondClient,
  writeModelConfig,
  type Gateway,
  type Rig,
  type SecondClient,
} from "./harness.ts";

interface Stack {
  model: FakeModel;
  home: string;
  gateway: Gateway;
  second: SecondClient;
}

async function startStack(rig: Rig): Promise<Stack> {
  const model = rig.own(await startFakeModel());
  const home = rig.home();
  writeModelConfig(home, model);
  rig.own(await startDaemon(home));
  const gateway = rig.own(await startGateway(home));
  const second = rig.own(await startSecondClient(home));
  return { model, home, gateway, second };
}

const composer = (page: Page): Locator => page.getByRole("textbox", { name: "Message" });
const card = (page: Page): Locator => page.getByRole("group", { name: "Approval" });
const answers = (page: Page): Locator => page.getByRole("article", { name: "golem" });

const OLD = "hello world\n";
const NEW = "hello there\n";
const EDITED = "hello edited\n";

interface Project {
  dir: string;
  file: string;
  sessionId: string;
}

/** A project folder holding notes.txt, and a session in it made by the second client. */
async function makeSession(rig: Rig, stack: Stack): Promise<Project> {
  const dir = realpathSync(rig.home());
  const file = path.join(dir, "notes.txt");
  writeFileSync(file, OLD);
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: dir });
  return { dir, file, sessionId };
}

function queueEdit(model: FakeModel): void {
  model.toolCall("edit_file", { path: "notes.txt", old_string: "world", new_string: "there" });
  model.reply("Done.");
}

/** Opens the gateway, then the session, and sends a message that makes the model ask to edit. */
async function askToEdit(page: Page, stack: Stack, project: Project): Promise<void> {
  await page.goto(stack.gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.goto(new URL(`/s/${project.sessionId}`, stack.gateway.url).href);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await composer(page).fill("edit the notes");
  await composer(page).press("Enter");
  await expect(card(page)).toBeVisible();
}

function read(project: Project): string {
  return readFileSync(project.file, "utf8");
}

test("allowing an edit from its diff changes the file and the card shrinks", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const project = await makeSession(rig, stack);
  queueEdit(stack.model);
  await askToEdit(page, stack, project);
  await expect(card(page).getByRole("heading", { name: /Allow edit_file on notes\.txt\?/ })).toBeVisible();
  await expect(card(page).getByText("there")).toBeVisible();
  expect(read(project)).toBe(OLD);
  await card(page).getByRole("button", { name: /Allow once/ }).click();
  await expect(card(page)).toContainText("Allowed once");
  await expect(card(page).getByRole("button")).toHaveCount(0);
  await expect(answers(page).last()).toContainText("Done.");
  expect(read(project)).toBe(NEW);
});

test("denying an edit leaves the file and tells the model", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const project = await makeSession(rig, stack);
  queueEdit(stack.model);
  await askToEdit(page, stack, project);
  await card(page).getByRole("button", { name: /Deny/ }).click();
  await expect(card(page)).toContainText("Denied");
  await expect(page.getByRole("button", { name: /edit_file/ }).getByText("✗ denied", { exact: true })).toBeVisible();
  await expect(answers(page).last()).toContainText("Done.");
  expect(read(project)).toBe(OLD);
  expect(stack.model.requests).toHaveLength(2);
  const second = stack.model.requests[1] as { messages: { role: string; content: unknown }[] };
  const toolMessages = second.messages.filter((m) => m.role === "tool");
  expect(toolMessages).toHaveLength(1);
  expect(JSON.stringify(toolMessages[0]?.content).toLowerCase()).toContain("denied");
});

test("editing the arguments runs the edited call once", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const project = await makeSession(rig, stack);
  queueEdit(stack.model);
  await askToEdit(page, stack, project);
  await card(page).getByRole("button", { name: /Edit/ }).click();
  const field = card(page).getByRole("textbox", { name: "Arguments, as JSON. Allow runs the edited call once." });
  await expect(field).toBeVisible();
  await field.fill(JSON.stringify({ path: "notes.txt", old_string: "world", new_string: "edited" }));
  await card(page).getByRole("button", { name: /Allow once/ }).click();
  await expect(card(page)).toContainText("Allowed once, with edited arguments");
  await expect(answers(page).last()).toContainText("Done.");
  expect(read(project)).toBe(EDITED);
});

test("an answer from another client closes the card in the page", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const project = await makeSession(rig, stack);
  const needed = new Promise<string>((resolve) => {
    stack.second.client.onEvent((event) => {
      if (event.type === "approval.needed") resolve(event.data.call_id);
    });
  });
  await stack.second.client.attachSession(project.sessionId);
  queueEdit(stack.model);
  await askToEdit(page, stack, project);
  const callId = await needed;
  await stack.second.client.respondApproval(project.sessionId, callId, "allow");
  await expect(card(page)).toContainText("Allowed once");
  await expect(card(page).getByRole("button")).toHaveCount(0);
  await expect(answers(page).last()).toContainText("Done.");
  expect(read(project)).toBe(NEW);
});

for (const [theme, label] of [
  ["slip", "parchment"],
  ["kiln", "kiln"],
] as const) {
  test(`no serious accessibility violations with an approval open in the ${label} theme`, async ({ page, rig }) => {
    const stack = await startStack(rig);
    const project = await makeSession(rig, stack);
    queueEdit(stack.model);
    await askToEdit(page, stack, project);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await expect(card(page).getByRole("button", { name: /Allow once/ })).toBeVisible();
    expect(await axeViolations(page), "pending approval").toEqual([]);
    await card(page).getByRole("button", { name: /Edit/ }).click();
    await expect(card(page).getByRole("textbox")).toBeVisible();
    expect(await axeViolations(page), "editing arguments").toEqual([]);
  });
}
