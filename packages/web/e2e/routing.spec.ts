import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "./fixtures.ts";
import { startStack } from "./stack.ts";

test("the default route set in Settings is the route of the next new session", async ({ page, rig }) => {
  const stack = await startStack(rig);
  const config = path.join(stack.home, "config.toml");
  // A comment of the user's, which saving must keep.
  writeFileSync(config, `# my settings\n${readFileSync(config, "utf8")}`);
  const cwd = realpathSync(stack.home);

  const before = await stack.second.client.createSession({ cwd });
  const first = (await stack.second.client.listSessions()).sessions.find((item) => item.session_id === before.session_id);
  expect(first?.route).toBe("pinned");

  await page.goto(stack.gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.goto(new URL("/settings/routing", stack.gateway.url).href);
  await expect(page.getByRole("heading", { name: "How a new chat picks its model" })).toBeVisible();
  await page.getByRole("radio", { name: /^Local only/ }).click();
  await expect(page.getByRole("radio", { name: /^Local only/ })).toBeChecked();

  await expect.poll(() => readFileSync(config, "utf8")).toContain('mode = "local"');
  expect(readFileSync(config, "utf8")).toContain("# my settings");

  const after = await stack.second.client.createSession({ cwd });
  await expect
    .poll(async () => (await stack.second.client.listSessions()).sessions.find((item) => item.session_id === after.session_id)?.route)
    .toBe("local");

  // The page shows the saved value again after a reload.
  await page.reload();
  await expect(page.getByRole("radio", { name: /^Local only/ })).toBeChecked();
});
