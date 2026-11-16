import { PROTOCOL_MAJOR } from "../../protocol/gen/version.ts";
import { expect, test } from "./fixtures.ts";
import { startDaemon, startDevServer, startFakeDaemon, startGateway } from "./harness.ts";
import { railConnected, startStack } from "./stack.ts";

const BACKOFF_MS = 20_000;
/** The grace before the strip gives way to the screen (RESTART_GRACE_MS), and a margin. */
const SCREEN_MS = 40_000;
/** What Chrome logs when a test stops the gateway or the daemon on purpose. */
const STOPPED = [/WebSocket connection to .* failed/, /ERR_CONNECTION_REFUSED/, /ERR_CONNECTION_RESET/];

test("connects", async ({ page, rig }) => {
  const home = rig.home();
  rig.own(await startDaemon(home));
  const gateway = rig.own(await startGateway(home));
  await page.goto(gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await expect(page.getByRole("img", { name: /^golem v\S+ · connected/ })).toBeVisible();
  expect(page.url()).not.toContain("#t=");
});

test("an expired cookie asks for a fresh link", async ({ page, rig, tolerate }) => {
  tolerate.push(...STOPPED);
  const home = rig.home();
  rig.own(await startDaemon(home));
  const first = await startGateway(home);
  await page.goto(first.url);
  await expect(railConnected(page)).toBeVisible();
  await first.stop();
  rig.own(await startGateway(home, first.port));
  await page.reload();
  await expect(page.getByRole("heading", { name: "This page needs a fresh link" })).toBeVisible();
});

test("an older daemon is named", async ({ page, rig, tolerate }) => {
  tolerate.push(...STOPPED);
  const home = rig.home();
  // `golem` refuses to start on an older daemon, so start it on a current one and swap.
  const daemon = await startDaemon(home);
  const gateway = rig.own(await startGateway(home));
  await page.goto(gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await daemon.stop();
  rig.own(await startFakeDaemon(home, PROTOCOL_MAJOR - 1));
  await expect(page.getByRole("heading", { name: "The daemon is older than this page" })).toBeVisible({
    timeout: BACKOFF_MS,
  });
});

test("the daemon goes down and comes back", async ({ page, rig, tolerate }) => {
  tolerate.push(...STOPPED);
  test.setTimeout(90_000);
  const home = rig.home();
  const daemon = await startDaemon(home);
  const gateway = rig.own(await startGateway(home));
  await page.goto(gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await daemon.stop();
  await expect(page.getByRole("heading", { name: "golem's daemon is not running" })).toBeVisible({ timeout: SCREEN_MS });
  rig.own(await startDaemon(home));
  await expect(railConnected(page)).toBeVisible({ timeout: BACKOFF_MS });
});

test("a short reconnect shows the strip and keeps the page", async ({ page, rig, tolerate }) => {
  tolerate.push(...STOPPED);
  test.setTimeout(90_000);
  // A configured stack, so the page stays on the session list and not on /welcome, which has no panel.
  const { home, daemon, gateway } = await startStack(rig);
  await page.goto(gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await daemon.stop();
  await expect(page.getByRole("complementary", { name: "Sessions" }).getByText("Reconnecting to golem…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "golem's daemon is not running" })).toHaveCount(0);
  rig.own(await startDaemon(home));
  await expect(railConnected(page)).toBeVisible({ timeout: BACKOFF_MS });
  await expect(page.getByText("Reconnecting to golem…")).toHaveCount(0);
});

test("the gateway goes down", async ({ page, rig, tolerate }) => {
  test.setTimeout(90_000);
  tolerate.push(...STOPPED);
  const home = rig.home();
  rig.own(await startDaemon(home));
  const gateway = await startGateway(home);
  await page.goto(gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await gateway.stop();
  await expect(page.getByRole("heading", { name: "The golem page is not running" })).toBeVisible({ timeout: SCREEN_MS });
});

test("the dev server proxies to the gateway", async ({ page, rig }) => {
  test.setTimeout(90_000);
  const home = rig.home();
  rig.own(await startDaemon(home));
  rig.own(await startGateway(home));
  const dev = rig.own(await startDevServer(home));
  await page.goto(dev.link);
  await expect(railConnected(page)).toBeVisible();
});
