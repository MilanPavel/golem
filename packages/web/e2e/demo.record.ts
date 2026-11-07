// Records the web UI demo. Run it with `just demo-web`, which encodes the frames for the docs.
//
// Playwright's own video is soft at small text sizes, and Chrome's headless screencast stays at
// CSS pixels. So this takes screenshots in a loop instead: sharp PNGs at twice the pixel
// density, each with its time. The frames and an ffmpeg concat list land in DEMO_FRAMES. The
// pauses are for the viewer.

import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

import { DEMO_ASK, demoConfig, queueDemo, startDemoDaemon, writeDemoProject } from "./demo-scenario.ts";
import { startFakeModel } from "./fake-model.ts";
import { expect, test } from "./fixtures.ts";
import { startGateway, startSecondClient, writeConfig } from "./harness.ts";

const FRAMES = process.env.DEMO_FRAMES ?? path.resolve("test-results/demo/frames");

/** Starts taking frames. The returned function stops, and writes the frames and the concat list. */
async function capture(page: Page): Promise<() => Promise<void>> {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
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
      writeFileSync(path.join(FRAMES, file), Buffer.from(frame.data, "base64"));
      const next = frames[i + 1]?.at ?? end;
      lines.push(`file ${file}`, `duration ${Math.max(next - frame.at, 0.001).toFixed(3)}`);
    });
    // The concat demuxer needs the last file twice for its duration to count.
    lines.push(`file f${String(frames.length - 1).padStart(5, "0")}.png`);
    writeFileSync(path.join(FRAMES, "frames.txt"), `${lines.join("\n")}\n`);
  };
}

test.use({ viewport: { width: 1200, height: 720 }, colorScheme: "light" });

test("record the web UI demo", async ({ page, rig }) => {
  const model = rig.own(await startFakeModel());
  const home = rig.home();
  writeConfig(home, demoConfig(model));
  rig.own(await startDemoDaemon(home));
  const gateway = rig.own(await startGateway(home));
  const second = rig.own(await startSecondClient(home));

  const project = writeDemoProject(path.join(realpathSync(rig.home()), "my-project"));
  const { session_id: id } = await second.client.createSession({ cwd: project });
  queueDemo(model);

  await page.goto(gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.goto(new URL(`/s/${id}`, gateway.url).href);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  const hide = page.locator("header").getByRole("button", { name: "Hide details" });
  if (await hide.isVisible()) await hide.click();
  await page.waitForTimeout(300);

  const stop = await capture(page);
  await page.waitForTimeout(800);

  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.click();
  await composer.pressSequentially(DEMO_ASK, { delay: 38 });
  await page.waitForTimeout(500);
  await composer.press("Enter");

  const card = page.getByRole("group", { name: "Approval" });
  // The edit: the diff stays up long enough to read, then it is allowed.
  await expect(card).toBeVisible();
  await page.waitForTimeout(2800);
  await card.getByRole("button", { name: /Allow once/ }).click();

  // The test run: the command, then allowed.
  await expect(card.getByRole("button", { name: /Allow once/ })).toBeVisible();
  await page.waitForTimeout(2000);
  await card.getByRole("button", { name: /Allow once/ }).click();

  await expect(page.getByRole("article", { name: "golem" }).last()).toContainText("All three tests pass");
  await page.waitForTimeout(3500);
  await stop();
});
