import { PROTOCOL_MAJOR } from "../../protocol/gen/version.ts";
import { expect, test } from "./fixtures.ts";
import { startDaemon, startDevServer, startFakeDaemon, startGateway } from "./harness.ts";

const BACKOFF_MS = 20_000;
/** What Chrome logs when a test stops the gateway or the daemon on purpose. */
const STOPPED = [/WebSocket connection to .* failed/, /ERR_CONNECTION_REFUSED/, /ERR_CONNECTION_RESET/];

test("connects", async ({ page, rig }) => {
  const home = rig.home();
  rig.own(await startDaemon(home));
  const gateway = rig.own(await startGateway(home));
  await page.goto(gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await expect(page.getByText(/golem v/)).toBeVisible();
  expect(page.url()).not.toContain("#t=");
});

test("an expired cookie asks for a fresh link", async ({ page, rig, tolerate }) => {
  tolerate.push(...STOPPED);
  const home = rig.home();
  rig.own(await startDaemon(home));
  const first = await startGateway(home);
  await page.goto(first.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await first.stop();
  rig.own(await startGateway(home, first.port));
  await page.reload();
  await expect(page.getByRole("heading", { name: "This page needs a fresh link" })).toBeVisible();
});

test("an older daemon is named", async ({ page, rig }) => {
  const home = rig.home();
  rig.own(await startFakeDaemon(home, PROTOCOL_MAJOR - 1));
  const gateway = rig.own(await startGateway(home));
  await page.goto(gateway.url);
  await expect(page.getByRole("heading", { name: "The daemon is older than this page" })).toBeVisible();
});

test("the daemon goes down and comes back", async ({ page, rig, tolerate }) => {
  tolerate.push(...STOPPED);
  test.setTimeout(90_000);
  const home = rig.home();
  const daemon = await startDaemon(home);
  const gateway = rig.own(await startGateway(home));
  await page.goto(gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await daemon.stop();
  await expect(page.getByRole("heading", { name: "golem's daemon is not running" })).toBeVisible();
  rig.own(await startDaemon(home));
  await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: BACKOFF_MS });
});

test("the gateway goes down", async ({ page, rig, tolerate }) => {
  tolerate.push(...STOPPED);
  const home = rig.home();
  rig.own(await startDaemon(home));
  const gateway = await startGateway(home);
  await page.goto(gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await gateway.stop();
  await expect(page.getByRole("heading", { name: "golem web is not running" })).toBeVisible();
});

test("the dev server proxies to the gateway", async ({ page, rig }) => {
  test.setTimeout(90_000);
  const home = rig.home();
  rig.own(await startDaemon(home));
  rig.own(await startGateway(home));
  const dev = rig.own(await startDevServer(home));
  await page.goto(dev.link);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
});
