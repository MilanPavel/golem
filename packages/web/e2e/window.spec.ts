import { realpathSync } from "node:fs";

import { expect, test } from "./fixtures.ts";
import { answers, composer, startStack } from "./stack.ts";

const NAME = "llama3.2:3b";

test("the first answer from a local model shows its exact window in the trace", async ({ page, rig }) => {
  const stack = await startStack(rig, { ollama: { installed: [NAME], chatModel: NAME } });
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: realpathSync(rig.home()) });

  await page.goto(stack.gateway.url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.goto(new URL(`/s/${sessionId}`, stack.gateway.url).href);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await composer(page).fill("hello");
  await composer(page).press("Enter");
  await expect(answers(page).last()).toContainText("The stub answers.");

  await page.getByRole("button", { name: "Inspect" }).click();
  await page.getByRole("complementary", { name: "Trace inspector" }).getByRole("treeitem", { name: /model 1/ }).click();
  const meter = page.getByRole("region", { name: "Context window" });
  await expect(meter).toContainText("/ 32K");
  await expect(meter).not.toContainText("≈");
});
