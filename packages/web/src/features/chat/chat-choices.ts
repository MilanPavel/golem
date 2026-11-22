import { DEFAULT_FOOTER, isFooterPart, type FooterChoice } from "@golem/view";
import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/** The screen choices of Settings › Chat that are not `golem.detail`, `golem.thinking` or `golem.times`. Each is kept in the browser and read through try/catch; a missing or odd value is the default. */

function read(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // The choice then lasts until the page closes.
  }
}

// Open it when a step fails.

export const OPEN_ON_FAIL_KEY = "golem.openOnFail";

/** On unless the stored word is `off`. */
export function readOpenOnFail(): boolean {
  return read(OPEN_ON_FAIL_KEY) !== "off";
}

export const openOnFailStore = createStore<boolean>(readOpenOnFail());

export function setOpenOnFail(on: boolean): void {
  openOnFailStore.set(on);
  write(OPEN_ON_FAIL_KEY, on ? "on" : "off");
}

export function useOpenOnFail(): boolean {
  return useSyncExternalStore(openOnFailStore.subscribe, openOnFailStore.getSnapshot);
}

// The line under each answer.

export const FOOTER_KEY = "golem.footer";

/** The stored parts that are off and the checkbox; anything unreadable is the default. */
export function readFooter(): FooterChoice {
  const stored = read(FOOTER_KEY);
  if (stored === null) return DEFAULT_FOOTER;
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null) return DEFAULT_FOOTER;
    const { off, leaveOutEmpty } = value as { off?: unknown; leaveOutEmpty?: unknown };
    return {
      off: Array.isArray(off) ? off.filter(isFooterPart) : [],
      leaveOutEmpty: typeof leaveOutEmpty === "boolean" ? leaveOutEmpty : DEFAULT_FOOTER.leaveOutEmpty,
    };
  } catch {
    return DEFAULT_FOOTER;
  }
}

export const footerStore = createStore<FooterChoice>(readFooter());

export function setFooter(choice: FooterChoice): void {
  footerStore.set(choice);
  write(FOOTER_KEY, JSON.stringify(choice));
}

export function useFooter(): FooterChoice {
  return useSyncExternalStore(footerStore.subscribe, footerStore.getSnapshot);
}

// The key that sends a message.

export const SEND_KEY_KEY = "golem.sendKey";

/** `enter`: ↵ sends and ⇧↵ adds a line. `mod`: ⌘↵ sends and ↵ adds a line. */
export type SendKey = "enter" | "mod";

export function readSendKey(): SendKey {
  return read(SEND_KEY_KEY) === "mod" ? "mod" : "enter";
}

export const sendKeyStore = createStore<SendKey>(readSendKey());

export function setSendKey(key: SendKey): void {
  sendKeyStore.set(key);
  write(SEND_KEY_KEY, key);
}

export function useSendKey(): SendKey {
  return useSyncExternalStore(sendKeyStore.subscribe, sendKeyStore.getSnapshot);
}
