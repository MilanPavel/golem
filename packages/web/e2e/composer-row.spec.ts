import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { answers, railConnected, send, startStack } from "./stack.ts";

/** A repo under the user's home (the daemon resolves `~/…` there), on `main`, with a `feature` branch. */
function makeRepo(): { root: string; repo: string } {
  const root = mkdtempSync(path.join(os.homedir(), "golem-e2e-"));
  const repo = path.join(root, "repo");
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: "pipe" });
  git("commit", "-q", "--allow-empty", "-m", "first");
  git("branch", "feature");
  return { root, repo };
}

const head = (repo: string): string => execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

/** The row is on one line: every chip starts at the same height, and the row is no taller than a chip. */
async function expectOneLine(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  const row = page.locator("[data-composer-bar]");
  const tops = await row.locator("button, [title]").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  const box = await row.boundingBox();
  expect(Math.max(...tops) - Math.min(...tops), `width ${width}`).toBeLessThanOrEqual(4);
  expect(box?.height ?? 0, `width ${width}`).toBeLessThanOrEqual(40);
}

test("the composer's row stays one line at every width, and its model, folder and mode stay reachable", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: realpathSync(rig.home()) });
  await page.goto(stack.gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await page.goto(new URL(`/s/${sessionId}`, stack.gateway.url).href);
  await expect(railConnected(page)).toBeVisible();

  const row = page.locator("[data-composer-bar]");
  await expect(row).toBeVisible();
  const heights: number[] = [];
  for (const width of [1280, 900, 700, 560, 460, 380, 320]) {
    await page.setViewportSize({ width, height: 800 });
    // Every chip is on the first line of the row, and the row is as tall as its tallest chip: no wrap.
    const tops = await row.locator("button, [title]").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    const box = await row.boundingBox();
    heights.push(box?.height ?? 0);
    expect(Math.max(...tops) - Math.min(...tops), `width ${width}`).toBeLessThanOrEqual(4);
    expect(box?.height ?? 0, `width ${width}`).toBeLessThanOrEqual(40);
    await expect(row.getByRole("button", { name: /^Model:/ })).toBeVisible();
    await expect(row.getByRole("button", { name: /^Permission mode:/ })).toBeVisible();
    await expect(row.getByRole("button", { name: "Send" })).toBeVisible();
  }
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
});

test("home: a typed ~/ path is offered, a branch is picked, and the session starts on it", async ({ page, rig }) => {
  const { root, repo } = makeRepo();
  try {
    const stack = await startStack(rig);
    stack.model.reply("Done.");
    await page.goto(stack.gateway.url);
    await expect(railConnected(page)).toBeVisible();

    const typed = `~/${path.basename(root)}/repo`;
    await page.getByRole("button", { name: /^Folder:/ }).click();
    const field = page.getByRole("combobox", { name: "Filter, or type a path" });
    await field.fill("~/");
    await expect(page.getByRole("option", { name: /^Use ~\// })).toBeVisible();
    await field.fill(typed);
    await expect(page.getByRole("option", { name: new RegExp(`^Use ${typed}`) })).toBeVisible();
    await field.press("Enter");
    await expect(page.getByRole("button", { name: "Folder: repo" })).toBeVisible();

    await page.getByRole("button", { name: "Branch: main" }).click();
    const menu = page.getByRole("dialog", { name: "Branches" });
    await menu.getByRole("button", { name: /feature/ }).click();
    await expect(page.getByRole("button", { name: "Branch: feature" })).toBeVisible();

    for (const width of [1280, 900, 390]) await expectOneLine(page, width);
    await page.setViewportSize({ width: 1280, height: 800 });

    await send(page, "hello");
    await page.waitForURL(/\/s\/[^/]+$/);
    await expect(answers(page)).toContainText("Done.");
    await expect(page.getByRole("button", { name: "Branch: feature" })).toBeVisible();
    expect(head(repo)).toBe("feature");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("in a session, the branch menu says each other branch starts a new session", async ({ page, rig }) => {
  const { root, repo } = makeRepo();
  try {
    const stack = await startStack(rig);
    const { session_id: sessionId } = await stack.second.client.createSession({ cwd: realpathSync(repo) });
    await page.goto(new URL(`/s/${sessionId}`, stack.gateway.url).href);
    await expect(railConnected(page)).toBeVisible();

    await page.getByRole("button", { name: "Branch: main" }).click();
    const menu = page.getByRole("dialog", { name: "Branches" });
    await expect(menu).toContainText("This session stays on main.");
    await expect(menu.getByRole("button", { name: /feature/ })).toContainText("New session ↗");
    for (const width of [1280, 900, 390]) await expectOneLine(page, width);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
