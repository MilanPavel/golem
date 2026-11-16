import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "./fixtures.ts";
import { answers, composer, railConnected, startStack } from "./stack.ts";

const NAME = "llama3.2:3b";
const TURNS = 6;

test("a few large tool results fill the context, and Clear in the chip's popover brings it down", async ({ page, rig }) => {
  const stack = await startStack(rig, { ollama: { installed: [NAME], chatModel: NAME } });
  const dir = realpathSync(rig.home());
  const { session_id: sessionId } = await stack.second.client.createSession({ cwd: dir });
  for (let at = 0; at < TURNS; at += 1) writeFileSync(path.join(dir, `big-${at}.txt`), Array.from({ length: 250 }, (_, row) => `row ${at}.${row} of a file that is long`).join("\n"));

  await page.goto(stack.gateway.url);
  await expect(railConnected(page)).toBeVisible();
  await page.goto(new URL(`/s/${sessionId}`, stack.gateway.url).href);
  await expect(railConnected(page)).toBeVisible();

  // The first answer teaches golem the window; before it, golem clears early to be safe.
  await composer(page).fill("hello");
  await composer(page).press("Enter");
  await expect(answers(page)).toHaveCount(1);

  // One tool call and one answer for each turn: the queue holds the tool call of the turn at hand.
  for (let at = 0; at < TURNS; at += 1) {
    stack.ollama?.toolCall("read_file", { path: `big-${at}.txt` });
    await composer(page).fill(`read big-${at}`);
    await composer(page).press("Enter");
    await expect(answers(page)).toHaveCount(at + 2);
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  }

  const chip = page.getByRole("button", { name: /^Context / });
  const percent = async () => Number(/(\d+)%/.exec((await chip.textContent()) ?? "")?.[1] ?? Number.NaN);
  await expect.poll(percent).toBeGreaterThan(40);
  const before = await percent();

  await chip.click();
  const popover = page.getByRole("dialog", { name: "Context" });
  await expect(popover.getByText(/^frees ≈ .* · no model call$/)).toBeVisible();
  await popover.getByRole("button", { name: /^Clear old tool results/ }).click();
  await expect(popover).toBeHidden();
  await expect.poll(percent).toBeLessThan(before);
  await expect(chip).toContainText("cleared");
});
