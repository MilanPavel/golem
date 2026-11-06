import type { Locator, Page } from "@playwright/test";

import { expect } from "./fixtures.ts";
import { startFakeModel, type FakeModel } from "./fake-model.ts";
import { startFakeOllama, type FakeOllama } from "./fake-ollama.ts";
import {
  startDaemon,
  startGateway,
  startSecondClient,
  writeConfig,
  type Daemon,
  type Gateway,
  type Rig,
  type SecondClient,
} from "./harness.ts";

export interface Stack {
  model: FakeModel;
  home: string;
  daemon: Daemon;
  gateway: Gateway;
  second: SecondClient;
  ollama?: FakeOllama;
}

export interface StackOptions {
  /** Start a stub of Ollama, with these models installed. The daemon reaches it and not the real registry. */
  ollama?: { installed?: string[] };
  /** False leaves the fake model out of the config, as on a fresh install with no model chosen. Default true. */
  chat?: boolean;
}

/** Connections to the registry go to a closed port, and 127.0.0.1 skips the proxy. */
const NO_NETWORK = { HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost" };

/** A fake model, a daemon on a temp home, a gateway, and a second client on the daemon socket. */
export async function startStack(rig: Rig, options: StackOptions = {}): Promise<Stack> {
  const model = rig.own(await startFakeModel());
  const ollama = options.ollama === undefined ? undefined : rig.own(await startFakeOllama(options.ollama));
  const home = rig.home();
  const lines = ["session_titles = false"];
  if (options.chat !== false) {
    lines.push(
      'model_provider = "openai_compat"',
      'model_name = "fake"',
      `model_base_url = "${model.baseUrl}"`,
    );
  }
  if (ollama !== undefined) {
    lines.push("", "[providers.ollama]", `base_url = "${ollama.baseUrl}"`, "", "[ollama]", "start = false");
  }
  writeConfig(home, lines);
  const daemon = rig.own(await startDaemon(home, ollama === undefined ? {} : { env: NO_NETWORK }));
  const gateway = rig.own(await startGateway(home));
  const second = rig.own(await startSecondClient(home));
  return { model, home, daemon, gateway, second, ...(ollama === undefined ? {} : { ollama }) };
}

export const composer = (page: Page): Locator => page.getByRole("textbox", { name: "Message" });
export const answers = (page: Page): Locator => page.getByRole("article", { name: "golem" });
export const youSaid = (page: Page): Locator => page.getByRole("article", { name: "You" });
export const sessionsPanel = (page: Page): Locator => page.getByRole("complementary", { name: "Sessions" });

export async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

/** Opens the gateway link, sends the first message from the empty screen, and returns the session's path. */
export async function firstMessage(page: Page, url: string, text: string): Promise<string> {
  await page.goto(url);
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await send(page, text);
  await page.waitForURL(/\/s\/[^/]+$/);
  return new URL(page.url()).pathname;
}

/** The session id in a page path such as `/s/abc`. */
export function sessionId(pathname: string): string {
  return pathname.replace(/^\/s\//, "");
}

export function setTheme(page: Page, theme: "slip" | "kiln"): Promise<void> {
  return page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}
