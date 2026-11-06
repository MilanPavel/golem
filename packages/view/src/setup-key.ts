import type { ListedModel, ModelListResult } from "@golem/client";

import { elapsed, move, providerName, type Choice, type MoveKey, type PanelKey, type SetupLine } from "./setup-window.ts";

/**
 * With an API key: the Provider panel (B1) and the Key panel (B2–B3′) of
 * docs/design/setup-window.md. The daemon checks a key before it stores it
 * (ADR-035), and never reads the shell: a key found in the terminal's
 * environment is passed to it.
 */

export type HostedProvider = {
  id: string;
  name: string;
  blurb: string;
  /** Where to get a key, without the scheme. */
  console: string;
  /** The variable a shell usually holds the key in. */
  env: string;
  /** Model names to recommend, best first. The first one the provider lists wins. */
  prefer: readonly RegExp[];
};

export const HOSTED_PROVIDERS: readonly HostedProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    blurb: "Claude",
    console: "console.anthropic.com/settings/keys",
    env: "ANTHROPIC_API_KEY",
    prefer: [/sonnet/i, /opus/i],
  },
  {
    id: "openai",
    name: "OpenAI",
    blurb: "GPT",
    console: "platform.openai.com/api-keys",
    env: "OPENAI_API_KEY",
    prefer: [/^gpt-5(\.\d+)?$/i, /^gpt-5/i, /^gpt-4\.1$/i, /^gpt-4o$/i],
  },
  {
    id: "google",
    name: "Google",
    blurb: "Gemini",
    console: "aistudio.google.com/apikey",
    env: "GOOGLE_API_KEY",
    prefer: [/^gemini-\d+(\.\d+)?-pro$/i, /^gemini-\d+(\.\d+)?-flash$/i, /^gemini-/i],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    blurb: "DeepSeek V3 and R1",
    console: "platform.deepseek.com/api_keys",
    env: "DEEPSEEK_API_KEY",
    prefer: [/^deepseek-chat$/i, /^deepseek-v\d/i, /^deepseek-/i],
  },
  {
    id: "xai",
    name: "xAI",
    blurb: "Grok",
    console: "console.x.ai",
    env: "XAI_API_KEY",
    prefer: [/^grok-\d+(\.\d+)?$/i, /^grok-\d/i, /^grok-/i],
  },
  {
    id: "moonshot",
    name: "Moonshot",
    blurb: "Kimi",
    console: "platform.moonshot.ai/console/api-keys",
    env: "MOONSHOT_API_KEY",
    prefer: [/^kimi-k\d+(\.\d+)?$/i, /^kimi-k\d/i, /^kimi-/i, /^moonshot-v1-128k$/i],
  },
];

export function hostedProvider(id: string): HostedProvider | null {
  return HOSTED_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

// Provider

function providerChoices(listing: ModelListResult | null): Choice<string>[] {
  const keyed = new Set(listing?.setup.keys ?? []);
  return HOSTED_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.name,
    detail: keyed.has(provider.id) ? `${provider.blurb} · key saved` : provider.blurb,
  }));
}

/** The row Enter takes first: a provider with a key saved, else Anthropic. */
export function providerSelected(listing: ModelListResult | null): number {
  const keyed = new Set(listing?.setup.keys ?? []);
  const at = HOSTED_PROVIDERS.findIndex((provider) => keyed.has(provider.id));
  return at < 0 ? 0 : at;
}

export function providerLines(listing: ModelListResult | null, selected: number): SetupLine[] {
  return [
    { kind: "title", text: "With an API key · which provider?" },
    { kind: "blank" },
    ...providerChoices(listing).map(
      (choice, index): SetupLine => ({ kind: "option", label: choice.label, detail: choice.detail, selected: index === selected }),
    ),
  ];
}

export function pressProvider(
  listing: ModelListResult | null,
  selected: number,
  key: MoveKey | "enter",
): { selected: number; provider: string | null } {
  const choices = providerChoices(listing);
  if (key !== "enter") {
    return { selected: move(selected, choices.length, key), provider: null };
  }
  return { selected, provider: choices[selected]?.id ?? null };
}

// Key

export type KeyState =
  | { phase: "found"; provider: string; selected: number }
  | { phase: "typing"; provider: string; value: string; error: string | null }
  | { phase: "checking"; provider: string; since: number }
  | { phase: "works"; provider: string; models: number | null; since: number };

/** After this, a check or the model list may be waiting on the macOS Keychain dialog (B3′). */
export const KEYCHAIN_HINT_MS = 1_500;

/** The panel as it opens: "Use it" first when the shell has the provider's key. */
export function openKey(provider: string, fromShell: string | null): KeyState {
  return fromShell !== null && fromShell.trim().length > 0
    ? { phase: "found", provider, selected: 0 }
    : { phase: "typing", provider, value: "", error: null };
}

const SHOWN_DOTS = 28;

/** Dots for the typed key, and its length once there are too many to count. */
export function maskKey(value: string): string {
  const length = [...value].length;
  return length <= SHOWN_DOTS ? "•".repeat(length) : `${"•".repeat(SHOWN_DOTS)} ${length}`;
}

const KEYCHAIN: SetupLine = { kind: "text", text: "Stored in your macOS Keychain, never in a file.", dim: true };

const KEYCHAIN_DIALOG: SetupLine[] = [
  { kind: "blank" },
  { kind: "status", mark: "attn", text: "If macOS asks whether golem may use the key," },
  { kind: "text", text: '  choose "Always Allow" in the dialog.', dim: true },
];

/** What a waiting Keychain read is for: `your OpenAI key`, `your github token`. */
function secretLabel(names: readonly string[]): string {
  const labels = names.map((name) => {
    if (name.startsWith("provider/")) {
      const id = name.slice("provider/".length);
      return hostedProvider(id)?.name ?? id;
    }
    return name.slice(name.indexOf("/") + 1);
  });
  const joined = labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;
  const tokens = names.every((name) => name.startsWith("provider/")) ? (names.length > 1 ? "keys" : "key") : names.length > 1 ? "secrets" : "token";
  return `your ${joined} ${tokens}`;
}

/**
 * The band while a Keychain read waits on macOS, from `keychain.wait`. A build
 * without an Apple Team ID asks again after each upgrade (ADR-021), and the
 * dialog would otherwise come with no word from golem. Null when nothing waits.
 */
export function keychainNotice(waiting: readonly string[]): string | null {
  return waiting.length === 0 ? null : `macOS is asking whether golem may use ${secretLabel(waiting)} · choose Always Allow`;
}

/** The same, under any panel of the setup window. */
export function keychainLines(waiting: readonly string[]): SetupLine[] {
  if (waiting.length === 0) {
    return [];
  }
  return [
    { kind: "blank" },
    { kind: "status", mark: "attn", text: `macOS is asking whether golem may use ${secretLabel(waiting)}.` },
    { kind: "text", text: '  Choose "Always Allow" in the dialog.', dim: true },
  ];
}

export function keyLines(state: KeyState, now: number): SetupLine[] {
  const provider = hostedProvider(state.provider);
  const name = provider?.name ?? state.provider;
  const head: SetupLine[] = [{ kind: "title", text: `${name} · API key` }, { kind: "blank" }];
  switch (state.phase) {
    case "found":
      return [
        ...head,
        { kind: "text", text: `Found ${provider?.env ?? "a key"} in your shell.` },
        { kind: "blank" },
        { kind: "option", label: "Use it", detail: "", selected: state.selected === 0 },
        { kind: "option", label: "Paste a different key", detail: "", selected: state.selected === 1 },
        { kind: "blank" },
        KEYCHAIN,
      ];
    case "typing":
      return [
        ...head,
        ...(state.error === null
          ? [{ kind: "text", text: "Paste your key:" } as const]
          : [{ kind: "status", mark: "fail", text: state.error } as const]),
        { kind: "field", text: maskKey(state.value) },
        { kind: "blank" },
        ...(provider === null ? [] : [{ kind: "text", text: `Get one at ${provider.console}`, dim: true } as const]),
        KEYCHAIN,
      ];
    case "checking":
      return [
        ...head,
        { kind: "status", mark: "spin", text: `checking the key with ${name}…`, right: elapsed(now - state.since) },
        ...(now - state.since >= KEYCHAIN_HINT_MS ? KEYCHAIN_DIALOG : []),
      ];
    case "works": {
      const count = state.models === null ? "" : ` · ${state.models} model${state.models === 1 ? "" : "s"} available`;
      return [
        ...head,
        { kind: "status", mark: "ok", text: `key works${count}` },
        { kind: "status", mark: "spin", text: "listing them…", right: elapsed(now - state.since) },
        ...(now - state.since >= KEYCHAIN_HINT_MS ? KEYCHAIN_DIALOG : []),
      ];
    }
  }
}

/** What reaches the Key panel: a move, Enter, Esc, typed or pasted text, or a deletion. */
export type KeyInput =
  | { kind: MoveKey | "enter" | "back" }
  | { kind: "text"; text: string }
  | { kind: "delete" }
  | { kind: "clear" };

export type KeyEffect =
  | { kind: "none" }
  | { kind: "check"; provider: string; key: "shell" | { typed: string } }
  | { kind: "back" };

export function pressKey(state: KeyState, input: KeyInput, now: number): { state: KeyState; effect: KeyEffect } {
  const none = { kind: "none" } as const;
  if (state.phase === "checking" || state.phase === "works") {
    return { state, effect: none };
  }
  if (input.kind === "back") {
    return { state, effect: { kind: "back" } };
  }
  if (state.phase === "found") {
    if (input.kind === "up" || input.kind === "down") {
      return { state: { ...state, selected: move(state.selected, 2, input.kind) }, effect: none };
    }
    if (input.kind !== "enter") {
      return { state, effect: none };
    }
    if (state.selected === 0) {
      return {
        state: { phase: "checking", provider: state.provider, since: now },
        effect: { kind: "check", provider: state.provider, key: "shell" },
      };
    }
    return { state: { phase: "typing", provider: state.provider, value: "", error: null }, effect: none };
  }
  switch (input.kind) {
    case "text":
      // A key has no whitespace, so a pasted line break or space is dropped.
      return { state: { ...state, value: state.value + input.text.replace(/\s+/g, "") }, effect: none };
    case "delete":
      return { state: { ...state, value: [...state.value].slice(0, -1).join("") }, effect: none };
    case "clear":
      return { state: { ...state, value: "" }, effect: none };
    case "enter": {
      const key = state.value.trim();
      if (key.length === 0) {
        return { state, effect: none };
      }
      return {
        state: { phase: "checking", provider: state.provider, since: now },
        effect: { kind: "check", provider: state.provider, key: { typed: key } },
      };
    }
    case "up":
    case "down":
      return { state, effect: none };
  }
}

/** The daemon answered: the key works, or the field opens again with the provider's reason. */
export function keyChecked(state: KeyState, result: { ok: true; models: number | null } | { ok: false; reason: string }, now: number): KeyState {
  if (state.phase !== "checking") {
    return state;
  }
  return result.ok
    ? { phase: "works", provider: state.provider, models: result.models, since: now }
    : { phase: "typing", provider: state.provider, value: "", error: result.reason };
}

// The Key panel of a page. The browser never takes a key (ADR-028): it shows the command to run
// in a terminal, and checks the listing again when asked.

export type PageKeyState =
  | { phase: "ask" }
  | { phase: "checking" }
  /** The provider already has a key: nothing to run, only Continue. */
  | { phase: "saved" }
  /** The check ran and the provider still has no key. */
  | { phase: "absent" };

export const ASK_PAGE_KEY: PageKeyState = { phase: "ask" };

/** The panel as it opens: Continue when the provider already has a key, else the command to run. */
export function openPageKey(missing: boolean): PageKeyState {
  return missing ? ASK_PAGE_KEY : { phase: "saved" };
}

/** What to type in a terminal to store the provider's key. */
export function pageKeyCommand(provider: string): string {
  return `golem auth set ${provider}`;
}

export function pageKeyLines(provider: string, state: PageKeyState): SetupLine[] {
  if (state.phase === "saved") {
    return [
      { kind: "title", text: `${providerName(provider)} · API key` },
      { kind: "blank" },
      { kind: "status", mark: "ok", text: `Key saved for ${providerName(provider)}.` },
      { kind: "blank" },
      { kind: "option", label: "Continue", detail: "", selected: true },
    ];
  }
  const lines: SetupLine[] = [
    { kind: "title", text: `${providerName(provider)} · API key` },
    { kind: "blank" },
    { kind: "text", text: "A web page never takes a key. In a terminal, run this and paste the key there:" },
  ];
  if (state.phase === "checking") {
    return [...lines, { kind: "blank" }, { kind: "status", mark: "spin", text: "checking…" }];
  }
  if (state.phase === "absent") {
    lines.push({ kind: "blank" }, { kind: "status", mark: "attn", text: "the key isn't there yet" });
  }
  return [...lines, { kind: "blank" }, { kind: "option", label: "Check again", detail: "", selected: true }];
}

export type PageKeyEffect = { kind: "none" } | { kind: "check" } | { kind: "done" } | { kind: "back" };

/** The one choice is Check again, so only Enter and Esc do anything. */
export function pressPageKey(state: PageKeyState, key: PanelKey): { state: PageKeyState; effect: PageKeyEffect } {
  if (key === "back") {
    return { state, effect: { kind: "back" } };
  }
  if (key !== "enter" || state.phase === "checking") {
    return { state, effect: { kind: "none" } };
  }
  if (state.phase === "saved") {
    return { state, effect: { kind: "done" } };
  }
  return { state: { phase: "checking" }, effect: { kind: "check" } };
}

/** The check came back: the provider still lacks a key, or it has one and the panel is done. */
export function pageKeyChecked(missing: boolean): PageKeyState | "done" {
  return missing ? { phase: "absent" } : "done";
}

// The provider's models (B4)

/** The model to recommend from a provider's list: the first of its preferences it has, else the first model. */
export function recommendedHosted(models: readonly ListedModel[], provider: string): ListedModel | null {
  const listed = models.filter((model) => model.provider === provider && model.status === "ready");
  const prefer = hostedProvider(provider)?.prefer ?? [];
  for (const pattern of prefer) {
    const found = listed.find((model) => pattern.test(model.ref.slice(provider.length + 1)));
    if (found !== undefined) {
      return found;
    }
  }
  return listed[0] ?? null;
}
