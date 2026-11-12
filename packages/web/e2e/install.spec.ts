import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { REPO, startDaemon, startGateway } from "./harness.ts";

const DIST = path.join(REPO, "packages/web/dist");

async function connected(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
}

function newBuild(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => (window as unknown as { __newBuild?: boolean }).__newBuild);
}

test("Chrome sees the page as installable", async ({ page, rig }) => {
  const home = rig.home();
  rig.own(await startDaemon(home));
  const gateway = rig.own(await startGateway(home));
  await connected(page, gateway.url);

  const cdp = await page.context().newCDPSession(page);
  const manifest = (await cdp.send("Page.getAppManifest", {})) as {
    url: string;
    errors: unknown[];
    data?: string;
  };
  expect(manifest.errors).toEqual([]);
  expect(manifest.url.endsWith("/manifest.webmanifest")).toBe(true);
  const parsed = JSON.parse(manifest.data ?? "{}") as Record<string, unknown>;
  expect(parsed["name"]).toBe("golem");
  expect(parsed["start_url"]).toBe("/");

  // Playwright's browser context is incognito, so Chrome always reports `in-incognito`. That is
  // the only id seen on a good page; it says nothing about the page. Any other id is a regression.
  const installability = (await cdp.send("Page.getInstallabilityErrors", {})) as {
    installabilityErrors: Array<{ errorId: string }>;
  };
  const ids = installability.installabilityErrors.map((e) => e.errorId).filter((id) => id !== "in-incognito");
  expect(ids).toEqual([]);
});

test("no service worker is registered", async ({ page, rig }) => {
  const home = rig.home();
  rig.own(await startDaemon(home));
  const gateway = rig.own(await startGateway(home));
  await connected(page, gateway.url);
  const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  expect(registrations).toBe(0);
});

test("a changed page shows on the next load", async ({ page, rig }) => {
  // The gateway reads its page from packages/web/dist and lists the files when it starts, so the
  // second script goes there first. The folder is put back when the test is over.
  const index = path.join(DIST, "index.html");
  const original = readFileSync(index, "utf8");
  const second = path.join(DIST, "assets/upgrade-check-AAAAAAAA.js");
  writeFileSync(second, "window.__newBuild = true;\n");
  rig.own({
    stop: () => {
      rmSync(second, { force: true });
      writeFileSync(index, original);
      return Promise.resolve();
    },
  });

  const home = rig.home();
  rig.own(await startDaemon(home));
  const gateway = rig.own(await startGateway(home));
  await connected(page, gateway.url);
  expect(await newBuild(page)).toBeUndefined();

  const upgraded = original.replace(
    "</head>",
    '<script type="module" crossorigin src="/assets/upgrade-check-AAAAAAAA.js"></script></head>',
  );
  expect(upgraded).not.toBe(original);
  writeFileSync(index, upgraded);

  const response = await page.reload();
  expect(response?.headers()["cache-control"]).toBe("no-cache");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  expect(await newBuild(page)).toBe(true);
});
