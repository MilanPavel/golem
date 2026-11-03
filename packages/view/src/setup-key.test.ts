import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult } from "@golem/client";

import {
  HOSTED_PROVIDERS,
  KEYCHAIN_HINT_MS,
  keyChecked,
  keyLines,
  maskKey,
  openKey,
  pressKey,
  pressProvider,
  providerLines,
  providerSelected,
  recommendedHosted,
  type KeyState,
} from "./setup-key.ts";
import { modelChoices, modelLines, START_MODEL_PANEL } from "./setup-local.ts";
import { advance, single } from "./setup-window.ts";

function model(ref: string, extra: Partial<ListedModel> = {}): ListedModel {
  return { ref, label: ref.slice(ref.indexOf("/") + 1), provider: ref.slice(0, ref.indexOf("/")), source: "remote", status: "ready", ...extra };
}

const LISTING: ModelListResult = {
  default: null,
  models: [
    model("anthropic/claude-haiku-5-5", { label: "Claude Haiku 5.5" }),
    model("anthropic/claude-sonnet-5-5", { label: "Claude Sonnet 5.5" }),
    model("anthropic/claude-opus-5-5", { label: "Claude Opus 5.5" }),
    model("groq/llama-3.3-70b-versatile"),
  ],
  providers: [{ provider: "anthropic", status: "ready" }],
  setup: { ollama_installed: false, ollama_running: false, keys: [], default_status: null },
};

test("the Provider panel lists the hosted providers, with a saved key noted and chosen first", () => {
  const lines = providerLines(LISTING, 0);
  assert.deepEqual(lines[0], { kind: "title", text: "With an API key · which provider?" });
  assert.deepEqual(lines[2], { kind: "option", label: "Anthropic", detail: "Claude", selected: true });
  assert.equal(lines.length, 2 + HOSTED_PROVIDERS.length);
  const keyed = { ...LISTING, setup: { ...LISTING.setup, keys: ["groq"] } };
  assert.equal(providerSelected(keyed), 2);
  assert.ok(providerLines(keyed, 2).some((line) => line.kind === "option" && line.detail === "fast open models · key saved"));
  assert.deepEqual(pressProvider(LISTING, 0, "down"), { selected: 1, provider: null });
  assert.deepEqual(pressProvider(LISTING, 3, "enter"), { selected: 3, provider: "openrouter" });
});

test("a key in the shell is offered first, else the field opens, with where to get one", () => {
  assert.deepEqual(openKey("anthropic", "sk-ant-x"), { phase: "found", provider: "anthropic", selected: 0 });
  assert.deepEqual(openKey("anthropic", "  "), { phase: "typing", provider: "anthropic", value: "", error: null });
  const found = keyLines(openKey("anthropic", "sk"), 0);
  assert.ok(found.some((line) => line.kind === "text" && line.text === "Found ANTHROPIC_API_KEY in your shell."));
  const typing = keyLines(openKey("anthropic", null), 0);
  assert.ok(typing.some((line) => line.kind === "text" && line.text === "Get one at console.anthropic.com/settings/keys"));
  assert.ok(typing.some((line) => line.kind === "text" && line.text.startsWith("Stored in your macOS Keychain")));
});

test("typing and pasting fill the hidden field, and Enter checks the key", () => {
  let state: KeyState = openKey("anthropic", null);
  state = pressKey(state, { kind: "text", text: "sk-ant\n 123" }, 0).state;
  assert.equal(state.phase === "typing" && state.value, "sk-ant123");
  state = pressKey(state, { kind: "delete" }, 0).state;
  assert.equal(state.phase === "typing" && state.value, "sk-ant12");
  assert.ok(keyLines(state, 0).some((line) => line.kind === "field" && line.text === "••••••••"));
  const checked = pressKey(state, { kind: "enter" }, 5);
  assert.deepEqual(checked.effect, { kind: "check", provider: "anthropic", key: { typed: "sk-ant12" } });
  assert.equal(checked.state.phase, "checking");
  assert.deepEqual(pressKey(openKey("anthropic", null), { kind: "enter" }, 0).effect, { kind: "none" });
  assert.deepEqual(pressKey(openKey("anthropic", null), { kind: "back" }, 0).effect, { kind: "back" });
  assert.equal(maskKey("x".repeat(40)), `${"•".repeat(28)} 40`);
});

test("Use it checks the shell's key, and Paste a different key opens the field", () => {
  const found = openKey("openai", "sk-1");
  assert.deepEqual(pressKey(found, { kind: "enter" }, 0).effect, { kind: "check", provider: "openai", key: "shell" });
  const paste = pressKey(pressKey(found, { kind: "down" }, 0).state, { kind: "enter" }, 0);
  assert.deepEqual(paste.state, { phase: "typing", provider: "openai", value: "", error: null });
});

test("the check shows a spinner, the Keychain note after a moment, and the provider's reason when refused", () => {
  const checking: KeyState = { phase: "checking", provider: "anthropic", since: 0 };
  assert.deepEqual(keyLines(checking, 0)[2], { kind: "status", mark: "spin", text: "checking the key with Anthropic…", right: "0s" });
  assert.ok(!keyLines(checking, 0).some((line) => line.kind === "status" && line.mark === "attn"));
  assert.ok(keyLines(checking, KEYCHAIN_HINT_MS).some((line) => line.kind === "status" && line.mark === "attn"));
  const refused = keyChecked(checking, { ok: false, reason: "anthropic rejected the key (401 · invalid x-api-key)" }, 0);
  assert.deepEqual(refused, { phase: "typing", provider: "anthropic", value: "", error: "anthropic rejected the key (401 · invalid x-api-key)" });
  assert.ok(keyLines(refused, 0).some((line) => line.kind === "status" && line.mark === "fail"));
  const works = keyChecked(checking, { ok: true, models: 9 }, 3);
  assert.deepEqual(keyLines(works, 3)[2], { kind: "status", mark: "ok", text: "key works · 9 models available" });
  assert.deepEqual(pressKey(works, { kind: "enter" }, 0).effect, { kind: "none" });
});

test("the provider's models put the recommended one first", () => {
  assert.equal(recommendedHosted(LISTING.models, "anthropic")?.ref, "anthropic/claude-sonnet-5-5");
  assert.equal(recommendedHosted(LISTING.models, "groq")?.ref, "groq/llama-3.3-70b-versatile");
  assert.equal(recommendedHosted(LISTING.models, "together"), null);
  const choices = modelChoices(LISTING, { kind: "provider", provider: "anthropic" }, false);
  assert.deepEqual(
    choices.map((choice) => (choice.kind === "model" ? `${choice.label}|${choice.detail}` : choice.label)),
    ["Claude Sonnet 5.5|recommended", "Claude Haiku 5.5|", "Claude Opus 5.5|"],
  );
  assert.deepEqual(modelLines(LISTING, { kind: "provider", provider: "anthropic" }, START_MODEL_PANEL, 0)[0], {
    kind: "title",
    text: "Pick a model · Anthropic",
  });
});

test("a long list scrolls with the selection", () => {
  const many = { ...LISTING, models: Array.from({ length: 40 }, (_, index) => model(`openrouter/m${index}`)) };
  const lines = modelLines(many, { kind: "provider", provider: "openrouter" }, { phase: "pick", selected: 20, all: true }, 0);
  const options = lines.filter((line) => line.kind === "option");
  assert.equal(options.length, 12);
  assert.ok(lines.some((line) => line.kind === "text" && line.text.includes("↑")));
  assert.ok(lines.some((line) => line.kind === "text" && line.text.includes("↓")));
  assert.ok(options.some((line) => line.kind === "option" && line.selected));
});

test("alone, Provider leads to Key, and Key ends where it was opened from", () => {
  const provider = single("provider", "overview");
  const key = advance(provider, { kind: "provider", provider: "groq" }, { ollamaRunning: false });
  assert.equal(key.kind === "window" && key.window.view === "panel" && key.window.panel, "key");
  if (key.kind !== "window") {
    return;
  }
  assert.deepEqual(advance(key.window, { kind: "done" }, { ollamaRunning: false }), { kind: "window", window: { view: "overview" } });
  const back = advance(key.window, { kind: "cancelled" }, { ollamaRunning: false });
  assert.equal(back.kind === "window" && back.window.view === "panel" && back.window.panel, "provider");
  assert.deepEqual(advance(single("key", "chat"), { kind: "done" }, { ollamaRunning: false }), { kind: "chat", background: false });
});
