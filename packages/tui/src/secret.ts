import type { Press } from "./keys.ts";

/** A key being typed for `/login`. It lives here, never in the draft or message recall. */
export type SecretPrompt = {
  provider: string;
  value: string;
};

export type SecretStep = {
  prompt: SecretPrompt | null;
  /** Set once, when Enter submits a non-empty key. */
  submit: { provider: string; key: string } | null;
};

const SHOWN_DOTS = 24;

export function openSecret(provider: string): SecretPrompt {
  return { provider, value: "" };
}

/**
 * Every key press goes here while the prompt is open. Esc and Ctrl-C cancel,
 * Enter submits, Backspace deletes one character, Ctrl-U and Ctrl-W clear,
 * and anything else that types text appends it.
 */
export function pressSecret(prompt: SecretPrompt, press: Press): SecretStep {
  if (press.name === "escape" || press.name === "ctrl-c") {
    return { prompt: null, submit: null };
  }
  if (press.name === "return") {
    const key = prompt.value.trim();
    if (key.length === 0) {
      return { prompt, submit: null };
    }
    return { prompt: null, submit: { provider: prompt.provider, key } };
  }
  if (press.name === "backspace") {
    return { prompt: { ...prompt, value: [...prompt.value].slice(0, -1).join("") }, submit: null };
  }
  if (press.name === "ctrl-u" || press.name === "ctrl-w") {
    return { prompt: { ...prompt, value: "" }, submit: null };
  }
  if ((press.name === null || press.name === "question") && !press.ctrl && !press.meta && press.input.length > 0) {
    return { prompt: pasteSecret(prompt, press.input), submit: null };
  }
  return { prompt, submit: null };
}

/** A key has no whitespace, so a pasted line break or space is dropped. */
export function pasteSecret(prompt: SecretPrompt, text: string): SecretPrompt {
  return { ...prompt, value: prompt.value + text.replace(/\s+/g, "") };
}

/** What the composer shows: dots, and the length once there are too many dots to count. */
export function maskSecret(value: string): string {
  const length = [...value].length;
  if (length <= SHOWN_DOTS) {
    return "\u2022".repeat(length);
  }
  return `${"\u2022".repeat(SHOWN_DOTS)} ${length} chars`;
}

export function secretNotice(provider: string): string {
  return `${provider} API key: paste it, Enter saves it in the Keychain, Esc cancels`;
}
