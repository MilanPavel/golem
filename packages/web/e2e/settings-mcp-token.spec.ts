import path from "node:path";
import type { Page } from "@playwright/test";

import { startFakeMcp } from "./fake-mcp.ts";
import { startFakeModel } from "./fake-model.ts";
import { expect, test } from "./fixtures.ts";
import { REPO, startDaemon, startGateway, writeConfig, type Rig } from "./harness.ts";
import { railConnected } from "./stack.ts";

const GOOD = "good-token";
const WRONG = "wrong-token";

/** A tool server that wants a token, a daemon that keeps tokens in memory, and a gateway. The server's config names a token that is not stored yet. */
async function startTokenStack(rig: Rig) {
  const model = rig.own(await startFakeModel());
  const mcp = rig.own(await startFakeMcp(GOOD));
  const home = rig.home();
  writeConfig(home, [
    "session_titles = false",
    'model_provider = "openai_compat"',
    'model_name = "fake"',
    `model_base_url = "${model.baseUrl}"`,
    "",
    "[mcp.hub]",
    `url = "${mcp.url}"`,
    'headers = { Authorization = "Bearer keychain:mcp/hub" }',
  ]);
  // The daemon's secrets are in memory (see mcp_daemon.py): the test never touches the Keychain.
  const daemon = rig.own(await startDaemon(home, { command: ["python", path.join(REPO, "packages/web/e2e/mcp_daemon.py")] }));
  const gateway = rig.own(await startGateway(home));
  return { mcp, daemon, gateway };
}

async function openHub(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(railConnected(page)).toBeVisible();
  await page.getByRole("navigation", { name: "Sidebar rail" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "MCP servers" }).click();
  await expect(page).toHaveURL(/\/settings\/mcp$/);
  await page.getByRole("button", { name: /hub/ }).first().click();
}

test("a server that refuses a token keeps the old state, and one that accepts it saves the token", async ({ page, rig }) => {
  const { mcp, gateway } = await startTokenStack(rig);
  await openHub(page, gateway.url);

  // Nothing is stored yet: the line under the name says so and offers to add it.
  const line = page.locator("[data-setting='mcp token']");
  await expect(line).toContainText("Token missing");
  await line.getByRole("button", { name: "Add it" }).click();

  // A token the server refuses is not kept.
  const field = page.getByLabel(/value$/);
  await field.fill(WRONG);
  await page.getByRole("button", { name: "Save" }).click();
  const steps = page.getByRole("list", { name: "Test steps" });
  await expect(steps).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "The server refused this token. Nothing was saved." })).toBeVisible();
  await expect(line).toContainText("Token missing");
  expect(mcp.seen).toContain(`Bearer ${WRONG}`);

  // Try again with the right one: it is tested, then kept.
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByLabel(/value$/).fill(GOOD);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The new token works and is saved." })).toBeVisible();
  expect(mcp.seen).toContain(`Bearer ${GOOD}`);
  await expect(line).toContainText("in the Keychain as mcp/hub");
  await expect(line.getByRole("button", { name: "Replace" })).toBeVisible();
});
