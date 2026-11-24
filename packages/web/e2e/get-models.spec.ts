import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { railConnected, startStack, type Stack } from "./stack.ts";

/** A name that is in the list golem ships, so no registry is asked. */
const NAME = "qwen3";

const getModels = (page: Page): Locator => page.getByRole("group", { name: "Get models" });
const tab = (page: Page, name: RegExp): Locator => getModels(page).getByRole("tablist", { name: "Where to get models" }).getByRole("tab", { name });

/** Opens the gateway link (it carries the login), then Settings › Models › Ollama › Get models. */
async function openGetModels(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(railConnected(page)).toBeVisible();
  await page.getByRole("navigation", { name: "Sidebar rail" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Models", exact: true }).click();
  await page.getByRole("button", { name: /^Ollama, / }).click();
  await page.getByRole("button", { name: "Get models" }).first().click();
  await expect(getModels(page)).toBeVisible();
}

/** Opens the Ollama library tab, picks a name from the shipped list, and starts its first size while pulls are held. Returns the ref. */
async function startFirstSize(page: Page, stack: Stack): Promise<string> {
  const get = getModels(page);
  await tab(page, /^Ollama library/).click();
  await expect(tab(page, /^Ollama library/)).toHaveAttribute("aria-selected", "true");
  await get.getByRole("list", { name: "Ollama library names" }).getByRole("button", { name: new RegExp(`^${NAME}`) }).first().click();
  const sizes = get.getByRole("group", { name: new RegExp(`^Sizes of ${NAME}`) });
  await expect(sizes).toBeVisible();
  stack.ollama?.holdPulls();
  const first = sizes.getByRole("button", { name: /^Download / }).first();
  const ref = ((await first.getAttribute("aria-label")) ?? "").replace(/^Download /, "");
  expect(ref).not.toBe("");
  await first.click();
  return ref;
}

test("Get models: search over the three tabs, a download in the tray and in Ollama's table, and Esc goes back", async ({ page, rig }) => {
  const stack = await startStack(rig, { ollama: {} });
  await openGetModels(page, stack.gateway.url);
  const get = getModels(page);

  // It opens on golem's list for this Mac, with the tray's quiet line at the foot.
  await expect(tab(page, /^Picked for this Mac/)).toHaveAttribute("aria-selected", "true");
  await expect(get.getByText("Downloads show up here. They keep going when you leave.")).toBeVisible();

  // One search field: the text stays from tab to tab, and the placeholder says what the tab searches.
  const search = get.getByRole("searchbox", { name: "Search" });
  await search.fill(NAME);
  await tab(page, /^Hugging Face/).click();
  await expect(tab(page, /^Hugging Face/)).toHaveAttribute("aria-selected", "true");
  await expect(search).toHaveValue(NAME);
  await expect(search).toHaveAttribute("placeholder", /Hugging Face/);

  // The Ollama library comes from the list shipped with golem: a name, then its sizes. Start one.
  const ref = await startFirstSize(page, stack);
  await expect(get).toBeVisible();
  const tray = get.getByRole("list", { name: "Downloads" });
  await expect(tray.getByRole("progressbar", { name: `Downloading ${ref}` })).toBeVisible();
  await expect(get.getByRole("group", { name: new RegExp(`^Sizes of ${NAME}`) }).getByRole("progressbar", { name: `Downloading ${ref}` })).toBeVisible();
  await expect.poll(() => stack.ollama?.pulls).toEqual([ref]);

  // Esc goes back to Ollama's page, and the download keeps going until it is done.
  await page.keyboard.press("Escape");
  await expect(get).toBeHidden();
  stack.ollama?.releasePulls();
  await expect(page.getByRole("button", { name: new RegExp(`^Show .*${ref.replace(/[.:]/g, "\\$&")}.* in the model menu`, "i") })).toBeVisible();
  expect(stack.ollama?.installed).toEqual([ref]);
});

test("Get models: a download is cancelled from the tray, and ‹ Ollama goes back", async ({ page, rig }) => {
  const stack = await startStack(rig, { ollama: {} });
  await openGetModels(page, stack.gateway.url);
  const get = getModels(page);

  const ref = await startFirstSize(page, stack);
  const tray = get.getByRole("list", { name: "Downloads" });
  await expect(tray.getByRole("progressbar", { name: `Downloading ${ref}` })).toBeVisible();

  await tray.getByRole("button", { name: `Cancel the download of ${ref}` }).click();
  await expect(tray.getByRole("progressbar", { name: `Downloading ${ref}` })).toBeHidden();
  stack.ollama?.releasePulls();
  expect(stack.ollama?.installed).toEqual([]);

  await get.getByRole("button", { name: "Back to Ollama" }).click();
  await expect(get).toBeHidden();
  await expect(page.getByRole("button", { name: "Get models" }).first()).toBeVisible();
});
