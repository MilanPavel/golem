import { expect, test, vi } from "vitest";
import { createAppInstall, installOffer, isMacSafari, type InstallEnv } from "./app-install.ts";

const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const EDGE = `${CHROME} Edg/126.0.0.0`;
const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0";

/** A window that can fire the events by hand. */
function fakeEnv(userAgent: string, standalone = false, extra: Partial<InstallEnv> = {}, nav: Partial<NonNullable<InstallEnv["navigator"]>> = {}) {
  const listeners = new Map<string, (event: Event) => void>();
  const env: InstallEnv = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    matchMedia: (query) => ({ matches: standalone && query === "(display-mode: standalone)" }),
    navigator: { userAgent, ...nav },
    ...extra,
  };
  return { env, fire: (type: string, event: Event = new Event(type)) => listeners.get(type)?.(event) };
}

function promptEvent(prompt: () => Promise<unknown>) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  return Object.assign(event, { prompt });
}

test("Safari on a Mac is told from Chrome, Edge and Firefox", () => {
  expect(isMacSafari(SAFARI)).toBe(true);
  expect(isMacSafari(CHROME)).toBe(false);
  expect(isMacSafari(EDGE)).toBe(false);
  expect(isMacSafari(FIREFOX)).toBe(false);
});

test("the saved prompt is held, its default is stopped, and install fires it once", async () => {
  const { env, fire } = fakeEnv(CHROME);
  const store = createAppInstall(env);
  expect(store.getSnapshot().prompt).toBe(false);
  const prompt = vi.fn(async () => ({ outcome: "accepted" }));
  const event = promptEvent(prompt);
  fire("beforeinstallprompt", event);
  expect(event.defaultPrevented).toBe(true);
  expect(store.getSnapshot().prompt).toBe(true);
  await store.install();
  await store.install();
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().prompt).toBe(false);
});

test("a prompt the browser refuses to show is dropped and nothing throws", async () => {
  const { env, fire } = fakeEnv(CHROME);
  const store = createAppInstall(env);
  fire("beforeinstallprompt", promptEvent(async () => Promise.reject(new Error("no"))));
  await expect(store.install()).resolves.toBeUndefined();
  expect(store.getSnapshot().prompt).toBe(false);
});

test("appinstalled marks the page installed and drops the prompt", () => {
  const { env, fire } = fakeEnv(CHROME);
  const store = createAppInstall(env);
  fire("beforeinstallprompt", promptEvent(async () => undefined));
  fire("appinstalled");
  expect(store.getSnapshot()).toMatchObject({ prompt: false, installed: true });
});

test("the offer: Chrome with a saved prompt, Safari, Chrome's menu, other, standalone, installed", () => {
  const chrome = fakeEnv(CHROME);
  const withPrompt = createAppInstall(chrome.env);
  chrome.fire("beforeinstallprompt", promptEvent(async () => undefined));
  expect(installOffer(withPrompt.getSnapshot())).toBe("prompt");

  expect(installOffer(createAppInstall(fakeEnv(SAFARI).env).getSnapshot())).toBe("safari");
  expect(installOffer(createAppInstall(fakeEnv(FIREFOX).env).getSnapshot())).toBe("other");
  // Chrome with no prompt saved (already installed, or not offered): the menu path.
  expect(installOffer(createAppInstall(fakeEnv(CHROME).env).getSnapshot())).toBe("chromium");
  expect(installOffer(createAppInstall(fakeEnv(EDGE).env).getSnapshot())).toBe("chromium");

  const standalone = createAppInstall(fakeEnv(CHROME, true).env);
  expect(installOffer(standalone.getSnapshot())).toBeNull();

  chrome.fire("appinstalled");
  expect(installOffer(withPrompt.getSnapshot())).toBe("installed");
});

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

test("appinstalled is kept, so a later page in a normal tab knows", () => {
  const storage = memory();
  const first = fakeEnv(CHROME, false, { localStorage: storage });
  createAppInstall(first.env);
  first.fire("appinstalled");
  const later = createAppInstall(fakeEnv(CHROME, false, { localStorage: storage }).env);
  expect(installOffer(later.getSnapshot())).toBe("installed");
});

test("storage that throws is ignored", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const { env, fire } = fakeEnv(CHROME, false, { localStorage: broken });
  const store = createAppInstall(env);
  expect(installOffer(store.getSnapshot())).toBe("chromium");
  fire("appinstalled");
  expect(installOffer(store.getSnapshot())).toBe("installed");
});

test("getInstalledRelatedApps listing golem makes the offer installed", async () => {
  const storage = memory();
  const store = createAppInstall(fakeEnv(CHROME, false, { localStorage: storage }, { getInstalledRelatedApps: async () => [{ url: "/manifest.webmanifest" }] }).env);
  await vi.waitFor(() => expect(installOffer(store.getSnapshot())).toBe("installed"));
  expect(storage.data.get("golem.app-installed")).toBe("1");
});

test("an empty or failing getInstalledRelatedApps changes nothing", async () => {
  for (const getInstalledRelatedApps of [async () => [], async () => Promise.reject(new Error("no"))]) {
    const store = createAppInstall(fakeEnv(CHROME, false, {}, { getInstalledRelatedApps }).env);
    await Promise.resolve();
    expect(installOffer(store.getSnapshot())).toBe("chromium");
  }
});

test("the app's own window is remembered as installed", () => {
  const storage = memory();
  createAppInstall(fakeEnv(CHROME, true, { localStorage: storage }).env);
  expect(storage.data.get("golem.app-installed")).toBe("1");
});
