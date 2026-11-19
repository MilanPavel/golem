// Records the three web UI demos: search, code and inbox. Run them with `just demo-web`, which
// encodes the frames of each one for the docs.
//
// Playwright's own video is soft at small text sizes, and Chrome's headless screencast stays at
// CSS pixels. So this takes screenshots in a loop instead: sharp PNGs at twice the pixel
// density, each with its time. The frames and an ffmpeg concat list of a clip land in
// DEMO_FRAMES/<clip>. The pauses are for the viewer.

import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

import {
  BRIEF_ROUTINE,
  RECEIPTS_ROUTINE,
  RUST_ASK_WEB,
  RUST_COMMAND,
  RUST_TITLE,
  SEARCH_TITLE,
  SEARCH_ASK,
  cargoEnv,
  demoConfig,
  dropReceipt,
  queueReceipts,
  queueRust,
  queueSearch,
  routineConfig,
  titleRun,
  runMorningBrief,
  startDemoDaemon,
  writeRustProject,
} from "./demo-scenario.ts";
import { startFakeModel } from "./fake-model.ts";
import { expect, test } from "./fixtures.ts";
import { startGateway, startSecondClient, writeConfig, type Rig } from "./harness.ts";
import { railConnected } from "./stack.ts";

const FRAMES = process.env.DEMO_FRAMES ?? path.resolve("test-results/demo/frames");

/** Starts taking frames. The returned function stops, and writes the frames and the concat list. */
async function capture(page: Page, name: string): Promise<() => Promise<void>> {
  const dir = path.join(FRAMES, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: { data: string; at: number }[] = [];
  // Without a clip, Chrome returns CSS pixels; scale 2 renders at twice the density.
  const { width, height } = page.viewportSize() ?? { width: 1200, height: 720 };
  const clip = { x: 0, y: 0, width, height, scale: 2 };
  let running = true;
  const loop = (async () => {
    while (running) {
      const at = performance.now() / 1000;
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip });
      frames.push({ data, at });
    }
  })();
  return async () => {
    running = false;
    await loop;
    const end = performance.now() / 1000;
    const lines = ["ffconcat version 1.0"];
    frames.forEach((frame, i) => {
      const file = `f${String(i).padStart(5, "0")}.png`;
      writeFileSync(path.join(dir, file), Buffer.from(frame.data, "base64"));
      const next = frames[i + 1]?.at ?? end;
      lines.push(`file ${file}`, `duration ${Math.max(next - frame.at, 0.001).toFixed(3)}`);
    });
    // The concat demuxer needs the last file twice for its duration to count.
    lines.push(`file f${String(frames.length - 1).padStart(5, "0")}.png`);
    writeFileSync(path.join(dir, "frames.txt"), `${lines.join("\n")}\n`);
  };
}

test.use({ viewport: { width: 1200, height: 720 }, colorScheme: "light" });

/** The folder a clip's sessions live in, named as it shows in the header. */
function projectIn(rig: Rig, name: string): string {
  return path.join(realpathSync(rig.home()), name);
}

/** Opens the session's page with the details drawer closed, unless the clip wants it. */
async function openSession(page: Page, url: string, id: string, options: { details: boolean }): Promise<void> {
  await page.goto(url);
  await expect(railConnected(page)).toBeVisible();
  await page.goto(new URL(`/s/${id}`, url).href);
  await expect(railConnected(page)).toBeVisible();
  const hide = page.locator("header").getByRole("button", { name: "Hide details" });
  if (!options.details && (await hide.isVisible())) await hide.click();
  await page.waitForTimeout(300);
}

async function ask(page: Page, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.click();
  await composer.pressSequentially(text, { delay: 38 });
  await page.waitForTimeout(500);
  await composer.press("Enter");
}

test("record the search demo", async ({ page, rig }) => {
  const model = rig.own(await startFakeModel());
  const home = rig.home();
  writeConfig(home, demoConfig(model));
  rig.own(await startDemoDaemon(home, { cannedWeb: true }));
  const gateway = rig.own(await startGateway(home));
  const second = rig.own(await startSecondClient(home));

  const folder = path.join(projectIn(rig, "notes"));
  mkdirSync(folder, { recursive: true });
  const { session_id: id } = await second.client.createSession({ cwd: folder });
  await second.client.renameSession(id, SEARCH_TITLE);
  queueSearch(model);
  await openSession(page, gateway.url, id, { details: false });

  const stop = await capture(page, "search");
  await page.waitForTimeout(800);
  await ask(page, SEARCH_ASK);

  const answer = page.getByRole("article", { name: "golem" }).last();
  await expect(answer).toContainText("Naive Set Theory");
  await page.waitForTimeout(1500);

  // A chip: the card opens with the title, the snippet, and that golem read the page.
  const chip = answer.getByRole("link", { name: /Source: plato\.stanford\.edu/ }).first();
  await chip.scrollIntoViewIfNeeded();
  await chip.hover();
  await expect(page.getByRole("dialog", { name: "Source" })).toBeVisible();
  await page.waitForTimeout(2200);
  await page.mouse.move(600, 40);
  await expect(page.getByRole("dialog", { name: "Source" })).toBeHidden();
  await page.waitForTimeout(400);

  // The Sources button: what was read, and what the answer cites.
  await page.getByRole("button", { name: /\d sources?$/ }).click();
  await expect(page.getByRole("region", { name: "Sources" })).toBeVisible();
  await page.waitForTimeout(2500);
  await stop();
});

test("record the inbox demo", async ({ page, rig }) => {
  const model = rig.own(await startFakeModel());
  const home = rig.home();
  const fakeHome = realpathSync(rig.home());
  const watched = path.join(fakeHome, "Receipts");
  const notes = path.join(fakeHome, "notes");
  const work = path.join(fakeHome, "work");
  mkdirSync(watched, { recursive: true });
  mkdirSync(notes, { recursive: true });
  mkdirSync(work, { recursive: true });
  writeConfig(home, demoConfig(model, "qwen3:30b", routineConfig(watched, work)));
  rig.own(await startDemoDaemon(home, { cannedWeb: true }));
  const gateway = rig.own(await startGateway(home));
  const second = rig.own(await startSecondClient(home));

  // A past run, so Runs has two rows: the scheduled routine ran once, from the real routine.run.
  await runMorningBrief(model, second);
  // The chat you are in when the receipt arrives: a finished search, asked off camera.
  const { session_id: id } = await second.client.createSession({ cwd: notes });
  await second.client.renameSession(id, SEARCH_TITLE);
  queueSearch(model);
  await openSession(page, gateway.url, id, { details: false });
  await ask(page, SEARCH_ASK);
  await expect(page.getByRole("article", { name: "golem" }).last()).toContainText("Naive Set Theory");
  await expect(page.getByRole("button", { name: /\d sources?$/ })).toBeVisible();
  await page.waitForTimeout(500);
  queueReceipts(model);
  // The folder watch has taken its first listing, so a file dropped now is new.
  await page.waitForTimeout(2500);

  const stop = await capture(page, "inbox");
  await page.waitForTimeout(1200);

  // A receipt lands in the watched folder. The routine fires by itself and stops at an approval.
  dropReceipt(watched);
  await titleRun(second, RECEIPTS_ROUTINE, "Receipts to CSV");
  const inbox = page.getByRole("button", { name: /^Inbox, 1 waiting/ });
  await expect(inbox).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2200);

  await inbox.click();
  const waiting = page.getByRole("list", { name: "Inbox" });
  await expect(waiting).toBeVisible();
  await page.waitForTimeout(3000);
  await waiting.getByRole("button", { name: /^Allow once/ }).click();
  await expect(page.getByText("Nothing is waiting for you.")).toBeVisible();
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "Runs" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("link", { name: /Open Runs/ }).click();
  await expect(page.getByText(RECEIPTS_ROUTINE).first()).toBeVisible();
  await expect(page.getByText(BRIEF_ROUTINE).first()).toBeVisible();
  await page.waitForTimeout(3500);
  await stop();
});

test("record the code demo", async ({ page, rig }) => {
  const model = rig.own(await startFakeModel());
  const home = rig.home();
  writeConfig(home, demoConfig(model, "qwen3-coder:30b"));
  rig.own(await startDemoDaemon(home, { env: cargoEnv() }));
  const gateway = rig.own(await startGateway(home));
  const second = rig.own(await startSecondClient(home));

  const project = writeRustProject(projectIn(rig, "rust-hello"));
  const { session_id: id } = await second.client.createSession({ cwd: project });
  await second.client.renameSession(id, RUST_TITLE);
  queueRust(model);
  await openSession(page, gateway.url, id, { details: true });
  await page.getByRole("tab", { name: /^Changes/ }).click();

  const stop = await capture(page, "code");
  await page.waitForTimeout(800);
  await ask(page, RUST_ASK_WEB);

  const card = page.getByRole("group", { name: "Approval" });
  // Each write: the diff stays up long enough to read, then it is allowed once.
  await expect(card).toBeVisible();
  await page.waitForTimeout(1800);
  await card.getByRole("button", { name: /Allow once/ }).click();
  await expect(card.getByText("src/main.rs", { exact: true })).toBeVisible();
  await page.waitForTimeout(2200);
  await card.getByRole("button", { name: /Allow once/ }).click();
  // The run: the command, then allowed.
  await expect(card.getByText(RUST_COMMAND)).toBeVisible();
  await page.waitForTimeout(2000);
  await card.getByRole("button", { name: /Allow once/ }).click();

  await expect(page.getByRole("article", { name: "golem" }).last()).toContainText("Hello, world!");
  await page.waitForTimeout(1500);
  // The panel ends on the change that matters: the greet function and its test.
  const row = (file: string) => page.locator(`li[data-path="${file}"] button[aria-expanded]`).first();
  await row("Cargo.toml").click();
  await row("src/main.rs").click();
  await page.waitForTimeout(3500);
  await stop();
});
