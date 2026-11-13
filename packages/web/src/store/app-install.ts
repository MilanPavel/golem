import { createStore, type StoreSource } from "./create-store.ts";

/** Which way this browser installs the page as an app. */
export type InstallWay = "prompt" | "safari" | "chromium" | "other";

/** What the page knows about being installed. */
export type AppInstallSnapshot = {
  /** A `beforeinstallprompt` was saved and can still be fired. */
  prompt: boolean;
  /** Safari on a Mac: no prompt, the Dock menu is the way. */
  safari: boolean;
  /** Chrome or Edge: no prompt saved means it is installed, or the browser holds it back; the menu still installs. */
  chromium: boolean;
  /** The page already runs in its own window. */
  standalone: boolean;
  /** golem is installed as an app: `appinstalled` was seen (and kept), the browser lists it, or this is its window. */
  installed: boolean;
};

export type AppInstallStore = StoreSource<AppInstallSnapshot> & {
  /** Fires the saved prompt. A prompt can be used once, so it is dropped either way. */
  install(): Promise<void>;
};

/** What the card says: the way to install, `installed`, or `null` for nothing. */
export type InstallOffer = InstallWay | "installed" | null;

/** The browser event that offers the install. Not in the DOM library's types. */
type InstallPromptEvent = Event & { prompt(): Promise<unknown> };

/** The parts of the window the store reads, so a test can give its own. */
export type InstallEnv = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { userAgent?: string; standalone?: boolean; getInstalledRelatedApps?: () => Promise<{ url?: string }[]> };
  localStorage?: Pick<Storage, "getItem" | "setItem">;
};

/** Chrome stops firing `beforeinstallprompt` once installed, and `appinstalled` only reaches the page that installed: this remembers it. */
const INSTALLED_KEY = "golem.app-installed";

function readInstalled(env: InstallEnv): boolean {
  try {
    return env.localStorage?.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberInstalled(env: InstallEnv): void {
  try {
    env.localStorage?.setItem(INSTALLED_KEY, "1");
  } catch {
    // No storage (private window): the flag lasts as long as this page.
  }
}

/** Chrome, Edge and the browsers built on Chromium, but not Safari or Firefox. */
export function isChromium(userAgent: string): boolean {
  return /Chrome|Chromium|Edg\//.test(userAgent) && !/CriOS|FxiOS|Android/.test(userAgent);
}

/** Safari on a Mac says `Safari/` and none of the browsers built on its name. */
export function isMacSafari(userAgent: string): boolean {
  return userAgent.includes("Macintosh") && userAgent.includes("Safari/") && !/Chrome|Chromium|CriOS|Edg|FxiOS|OPR|Android/.test(userAgent);
}

function isStandalone(env: InstallEnv): boolean {
  return env.matchMedia?.("(display-mode: standalone)").matches === true || env.navigator?.standalone === true;
}

/**
 * Whether the page can offer to become an app. It listens from the moment it is made, so make it
 * at load: `beforeinstallprompt` fires once, early, and is lost if nobody saved it.
 */
export function createAppInstall(env: InstallEnv = window): AppInstallStore {
  const store = createStore<AppInstallSnapshot>({
    prompt: false,
    safari: isMacSafari(env.navigator?.userAgent ?? ""),
    chromium: isChromium(env.navigator?.userAgent ?? ""),
    standalone: isStandalone(env),
    installed: readInstalled(env),
  });
  let saved: InstallPromptEvent | null = null;
  const change = (part: Partial<AppInstallSnapshot>): void => {
    store.set({ ...store.getSnapshot(), ...part });
  };
  env.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    saved = event as InstallPromptEvent;
    change({ prompt: true });
  });
  if (store.getSnapshot().standalone) {
    rememberInstalled(env);
  } else if (!store.getSnapshot().installed) {
    // Where the browser can say which apps of this site are installed, ask once.
    env.navigator?.getInstalledRelatedApps?.().then(
      (apps) => {
        if (apps.length > 0) {
          rememberInstalled(env);
          change({ installed: true });
        }
      },
      () => undefined,
    );
  }
  env.addEventListener("appinstalled", () => {
    saved = null;
    rememberInstalled(env);
    change({ prompt: false, installed: true });
  });
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    async install() {
      const event = saved;
      if (event === null) {
        return;
      }
      saved = null;
      change({ prompt: false });
      try {
        await event.prompt();
      } catch {
        // The browser refused to show it. The page offers nothing more until it fires again.
      }
    },
  };
}

/**
 * What to show: anywhere but the app's own window. Without the web job the page stops with the
 * terminal, but the Ready step says how to keep it right under this card, and hiding the card
 * would also hide that golem is already installed.
 */
export function installOffer(app: AppInstallSnapshot): InstallOffer {
  if (app.standalone) {
    return null;
  }
  if (app.installed) {
    return "installed";
  }
  return app.prompt ? "prompt" : app.safari ? "safari" : app.chromium ? "chromium" : "other";
}
