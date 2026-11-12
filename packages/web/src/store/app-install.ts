import { createStore, type StoreSource } from "./create-store.ts";

/** Which way this browser installs the page as an app. */
export type InstallWay = "prompt" | "safari" | "other";

/** What the page knows about being installed. */
export type AppInstallSnapshot = {
  /** A `beforeinstallprompt` was saved and can still be fired. */
  prompt: boolean;
  /** Safari on a Mac: no prompt, the Dock menu is the way. */
  safari: boolean;
  /** The page already runs in its own window. */
  standalone: boolean;
  /** The browser said `appinstalled` while this page was open. */
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
  navigator?: { userAgent?: string; standalone?: boolean };
};

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
    standalone: isStandalone(env),
    installed: false,
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
  env.addEventListener("appinstalled", () => {
    saved = null;
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
 * What to show. Only when the web job keeps the page running: a Dock icon on a page that stops
 * with the terminal opens a dead page. Never inside the app's own window.
 */
export function installOffer(app: AppInstallSnapshot, pageKept: boolean | null): InstallOffer {
  if (pageKept !== true || app.standalone) {
    return null;
  }
  if (app.installed) {
    return "installed";
  }
  return app.prompt ? "prompt" : app.safari ? "safari" : "other";
}
