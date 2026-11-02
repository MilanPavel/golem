import axe from "axe-core";
import type { Locator, Page } from "@playwright/test";

import { XSS_CORPUS } from "../src/features/chat/xss-corpus.ts";
import { startFakeModel, type FakeModel } from "./fake-model.ts";
import { expect, test } from "./fixtures.ts";
import { startDaemon, startGateway, writeModelConfig, type Daemon, type Gateway, type Rig } from "./harness.ts";

/** What Chrome logs when a test stops the gateway or the daemon on purpose. */
const STOPPED = [/WebSocket connection to .* failed/, /ERR_CONNECTION_REFUSED/, /ERR_CONNECTION_RESET/];
const RECONNECT_MS = 25_000;

interface Stack {
  model: FakeModel;
  home: string;
  daemon: Daemon;
  gateway: Gateway;
}

async function startStack(rig: Rig): Promise<Stack> {
  const model = rig.own(await startFakeModel());
  const home = rig.home();
  writeModelConfig(home, model);
  const daemon = await startDaemon(home);
  rig.own(daemon);
  const gateway = rig.own(await startGateway(home));
  return { model, home, daemon, gateway };
}

const composer = (page: Page): Locator => page.getByRole("textbox", { name: "Message" });
const stopButton = (page: Page): Locator => page.getByRole("button", { name: "Stop" });
const answers = (page: Page): Locator => page.getByRole("article", { name: "golem" });
const youSaid = (page: Page): Locator => page.getByRole("article", { name: "You" });

async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

/** Opens the gateway link, sends the first message from the empty screen, and returns the session's path. */
async function firstMessage(page: Page, url: string, text: string): Promise<string> {
  await page.goto(url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await send(page, text);
  await page.waitForURL(/\/s\/[^/]+$/);
  return new URL(page.url()).pathname;
}

/** Twenty numbered words, so a repeated or lost word shows. */
const COUNTED = Array.from({ length: 20 }, (_, i) => `w${String(i + 1).padStart(2, "0")}`).join(" ");

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("a message streams in and the Stop button comes and goes", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  model.reply(COUNTED, { delayMs: 150 });
  await page.goto(gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await send(page, "count for me");
  await page.waitForURL(/\/s\/[^/]+$/);
  await expect(youSaid(page)).toHaveText(/count for me/);
  await expect(stopButton(page)).toBeVisible();
  await expect(answers(page)).toContainText(COUNTED);
  await expect(stopButton(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(youSaid(page)).toHaveCount(1);
  expect(model.requests).toHaveLength(1);
});

test("a reload in the middle of an answer ends with the answer once", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  model.reply(COUNTED, { delayMs: 300 });
  await firstMessage(page, gateway.url, "count for me");
  await expect(answers(page)).toContainText("w03");
  await page.reload();
  await expect(answers(page)).toContainText(COUNTED, { timeout: 20_000 });
  await expect(stopButton(page)).toBeHidden();
  const text = await answers(page).innerText();
  for (let i = 1; i <= 20; i++) {
    const word = `w${String(i).padStart(2, "0")}`;
    expect(occurrences(text, word), word).toBe(1);
  }
  await expect(youSaid(page)).toHaveCount(1);
  await expect(answers(page)).toHaveCount(1);
});

test("a second tab sees the answer stream in", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  const path = await firstMessage(page, gateway.url, "first");
  await expect(stopButton(page)).toBeHidden();
  const other = await page.context().newPage();
  await other.goto(new URL(path, gateway.url).href);
  await expect(other.getByText("connected", { exact: true })).toBeVisible();
  await expect(youSaid(other)).toHaveText(/first/);
  for (const tab of [page, other]) {
    await expect(tab.getByRole("complementary", { name: "Sessions" }).getByRole("link")).toHaveCount(1);
  }
  model.reply(COUNTED, { delayMs: 200 });
  await send(page, "second");
  await expect(youSaid(other)).toHaveCount(2);
  await expect(stopButton(other)).toBeVisible();
  await expect(answers(other).last()).toContainText(COUNTED, { timeout: 20_000 });
  await expect(stopButton(other)).toBeHidden();
  await expect(answers(other)).toHaveCount(2);
  await expect(answers(page).last()).toContainText(COUNTED);
  await other.close();
});

test("a frozen tab shows the whole answer once when it wakes", async ({ page, rig }) => {
  const { model, gateway } = await startStack(rig);
  model.reply(COUNTED, { delayMs: 250 });
  await firstMessage(page, gateway.url, "count for me");
  await expect(answers(page)).toContainText("w02");
  await expect(page).toHaveTitle(/^● /);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  // The reply takes about five seconds; let it finish while the page cannot run.
  await expect.poll(() => model.requests.length).toBe(1);
  await new Promise((r) => setTimeout(r, 7_000));
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await expect(answers(page)).toContainText(COUNTED, { timeout: 20_000 });
  await expect(stopButton(page)).toBeHidden();
  await expect(page).not.toHaveTitle(/^● /);
  const text = await answers(page).innerText();
  for (let i = 1; i <= 20; i++) {
    const word = `w${String(i).padStart(2, "0")}`;
    expect(occurrences(text, word), word).toBe(1);
  }
  await expect(answers(page)).toHaveCount(1);
  await expect(youSaid(page)).toHaveCount(1);
});

test("the daemon restarts and the chat carries on", async ({ page, rig, tolerate }) => {
  tolerate.push(...STOPPED);
  test.setTimeout(120_000);
  const { model, home, daemon, gateway } = await startStack(rig);
  model.reply("The first answer.");
  await firstMessage(page, gateway.url, "first question");
  await expect(answers(page)).toContainText("The first answer.");
  await expect(stopButton(page)).toBeHidden();
  await daemon.stop();
  await expect(page.getByRole("heading", { name: "golem's daemon is not running" })).toBeVisible();
  rig.own(await startDaemon(home));
  await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: RECONNECT_MS });
  await expect(youSaid(page)).toHaveText(/first question/);
  await expect(answers(page)).toContainText("The first answer.");
  model.reply("The second answer.");
  await send(page, "second question");
  await expect(answers(page)).toHaveCount(2);
  await expect(answers(page).last()).toContainText("The second answer.");
  await expect(youSaid(page)).toHaveCount(2);
});

test("an expired cookie on a session asks for a fresh link", async ({ page, rig, tolerate }) => {
  tolerate.push(...STOPPED);
  const { model, home, gateway: first } = await startStack(rig);
  model.reply("Hello.");
  await firstMessage(page, first.url, "hi");
  await expect(answers(page)).toContainText("Hello.");
  await first.stop();
  rig.own(await startGateway(home, first.port));
  await page.reload();
  await expect(page.getByRole("heading", { name: "This page needs a fresh link" })).toBeVisible();
});

test("a model's answer cannot run script or leave hostile markup in the page", async ({ page, rig, tolerate, tolerateCsp }) => {
  // The sanitizer parses the "base href" case in a scratch document that shares the page's policy,
  // so Chrome reports base-uri for it although no <base> reaches the page (asserted below).
  tolerateCsp.push(/^base-uri https:\/\/example\.com\/$/);
  tolerate.push(/Setting the document's base URI to 'https:\/\/example\.com\/' violates .* "base-uri 'none'"/);
  test.setTimeout(180_000);
  const { model, gateway } = await startStack(rig);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await page.goto(gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  for (const [index, entry] of XSS_CORPUS.entries()) {
    model.reply(entry.markdown);
    await send(page, `case ${index + 1}`);
    if (index === 0) await page.waitForURL(/\/s\/[^/]+$/);
    await expect(answers(page)).toHaveCount(index + 1);
    await expect(stopButton(page)).toBeHidden();
    // Wait until the answer holds the whole text: the last request reached the model and finished.
    await expect.poll(() => model.requests.length).toBe(index + 1);
    const html = (await answers(page).nth(index).locator(".md").innerHTML()).toLowerCase();
    for (const bad of entry.absent) {
      expect(html, `${entry.name}: ${bad} must be absent`).not.toContain(bad.toLowerCase());
    }
    for (const good of entry.present) {
      expect(html, `${entry.name}: ${good} must be present`).toContain(good.toLowerCase());
    }
  }
  expect(dialogs).toEqual([]);
});

const MARKDOWN_ANSWER = `Here is a **short** answer with a list:

- first point, with \`inline code\`
- second point

\`\`\`ts
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

| col | value |
|-----|-------|
| a   | 1     |

A [link](https://example.com) to read.
`;

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axe.source);
  const results = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: Document) => Promise<{ violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[] }> } }).axe.run;
    return run(document);
  });
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

for (const [theme, label] of [
  ["slip", "parchment"],
  ["kiln", "kiln"],
] as const) {
  test(`no serious accessibility violations in the ${label} theme`, async ({ page, rig }) => {
    const { model, gateway } = await startStack(rig);
    await page.goto(gateway.url);
    await expect(page.getByText("connected", { exact: true })).toBeVisible();
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    expect(await axeViolations(page), "home screen").toEqual([]);

    model.reply(MARKDOWN_ANSWER);
    await send(page, "show me markdown");
    await page.waitForURL(/\/s\/[^/]+$/);
    await expect(answers(page).getByText("second point")).toBeVisible();
    await expect(stopButton(page)).toBeHidden();
    await expect(answers(page).locator('pre code[data-highlighted="true"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(theme);
    expect(await axeViolations(page), "session screen").toEqual([]);
  });
}
