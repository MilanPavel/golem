import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult } from "@golem/client";

import {
  HOSTED_PROVIDERS,
  KEYCHAIN_HINT_MS,
  keyChecked,
  keychainLines,
  keychainNotice,
  keyLines,
  maskKey,
  ASK_PAGE_KEY,
  openKey,
  openPageKey,
  pageKeyChecked,
  pageKeyCommand,
  pageKeyLines,
  pressPageKey,
  pressKey,
  pressProvider,
  providerLines,
  providerSelected,
  recommendedHosted,
  type KeyState,
} from "./setup-key.ts";
import { KEY_PROVIDERS } from "./commands.ts";
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
    model("openai/gpt-5"),
  ],
  providers: [{ provider: "anthropic", status: "ready" }],
  setup: { ollama_installed: false, ollama_running: false, keys: [], default_status: null },
};

test("the Provider panel lists the hosted providers, with a saved key noted and chosen first", () => {
  const lines = providerLines(LISTING, 0);
  assert.deepEqual(lines[0], { kind: "title", text: "With an API key · which provider?" });
  assert.deepEqual(lines[2], { kind: "option", label: "Anthropic", detail: "Claude", selected: true });
  assert.equal(lines.length, 2 + HOSTED_PROVIDERS.length);
  const keyed = { ...LISTING, setup: { ...LISTING.setup, keys: ["openai"] } };
  assert.equal(providerSelected(keyed), 1);
  assert.ok(providerLines(keyed, 1).some((line) => line.kind === "option" && line.detail === "GPT · key saved"));
  assert.deepEqual(pressProvider(LISTING, 0, "down"), { selected: 1, provider: null });
  assert.deepEqual(pressProvider(LISTING, 1, "enter"), { selected: 1, provider: "openai" });
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
  assert.deepEqual(keyLines(checking, 0)[2], { kind: "status", mark: "spin", text: "checking the key with Anthropic…", right: "0m 00s" });
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
  assert.equal(recommendedHosted(LISTING.models, "openai")?.ref, "openai/gpt-5");
  assert.equal(recommendedHosted(LISTING.models, "nobody"), null);
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

test("Google recommends the newest Pro model, then Flash", () => {
  const models = [model("google/gemini-2.5-flash"), model("google/gemini-2.5-pro"), model("google/gemini-live")];
  assert.equal(recommendedHosted(models, "google")?.ref, "google/gemini-2.5-pro");
  assert.equal(recommendedHosted(models.slice(0, 1), "google")?.ref, "google/gemini-2.5-flash");
});

test("DeepSeek recommends deepseek-chat, then any V model", () => {
  const models = [model("deepseek/deepseek-reasoner"), model("deepseek/deepseek-chat")];
  assert.equal(recommendedHosted(models, "deepseek")?.ref, "deepseek/deepseek-chat");
  assert.equal(recommendedHosted(models.slice(0, 1), "deepseek")?.ref, "deepseek/deepseek-reasoner");
});

test("xAI recommends the plain Grok model over its variants", () => {
  const models = [model("xai/grok-4.3-latest"), model("xai/grok-3-mini"), model("xai/grok-4.3")];
  assert.equal(recommendedHosted(models, "xai")?.ref, "xai/grok-4.3");
});

test("Moonshot recommends the plain Kimi model over its variants", () => {
  const models = [model("moonshot/kimi-k3.1-pro"), model("moonshot/moonshot-v1-8k"), model("moonshot/kimi-k3")];
  assert.equal(recommendedHosted(models, "moonshot")?.ref, "moonshot/kimi-k3");
});

test("the Provider panel and /login offer the six hosted providers", () => {
  const six = ["anthropic", "openai", "google", "deepseek", "xai", "moonshot"];
  assert.deepEqual(HOSTED_PROVIDERS.map((provider) => provider.id), six);
  assert.deepEqual([...KEY_PROVIDERS], six);
});

test("a long list scrolls with the selection", () => {
  const many = { ...LISTING, models: Array.from({ length: 40 }, (_, index) => model(`openai/m${index}`)) };
  const lines = modelLines(many, { kind: "provider", provider: "openai" }, { phase: "pick", selected: 20, all: true }, 0);
  const options = lines.filter((line) => line.kind === "option");
  assert.equal(options.length, 12);
  assert.ok(lines.some((line) => line.kind === "text" && line.text.includes("↑")));
  assert.ok(lines.some((line) => line.kind === "text" && line.text.includes("↓")));
  assert.ok(options.some((line) => line.kind === "option" && line.selected));
});

test("alone, Provider leads to Key, and Key ends where it was opened from", () => {
  const provider = single("provider", "overview");
  const key = advance(provider, { kind: "provider", provider: "openai" }, { ollamaRunning: false });
  assert.equal(key.kind === "window" && key.window.view === "panel" && key.window.panel, "key");
  if (key.kind !== "window") {
    return;
  }
  assert.deepEqual(advance(key.window, { kind: "done" }, { ollamaRunning: false }), { kind: "window", window: { view: "overview" } });
  const back = advance(key.window, { kind: "cancelled" }, { ollamaRunning: false });
  assert.equal(back.kind === "window" && back.window.view === "panel" && back.window.panel, "provider");
  assert.deepEqual(advance(single("key", "chat"), { kind: "done" }, { ollamaRunning: false }), { kind: "chat", background: false });
});

test("a Keychain read waiting on macOS is named in the band and under the panel", () => {
  assert.equal(keychainNotice([]), null);
  assert.deepEqual(keychainLines([]), []);
  assert.equal(keychainNotice(["provider/openai"]), "macOS is asking whether golem may use your OpenAI key · choose Always Allow");
  assert.equal(
    keychainNotice(["provider/openai", "provider/anthropic"]),
    "macOS is asking whether golem may use your OpenAI and Anthropic keys · choose Always Allow",
  );
  assert.equal(keychainNotice(["mcp/github"]), "macOS is asking whether golem may use your github token · choose Always Allow");
  const lines = keychainLines(["provider/openai"]);
  assert.deepEqual(lines[1], { kind: "status", mark: "attn", text: "macOS is asking whether golem may use your OpenAI key." });
  assert.equal(lines[2]?.kind === "text" && lines[2].text, '  Choose "Always Allow" in the dialog.');
});

test("the page's Key panel names the command and has one choice, Check again", () => {
  assert.equal(pageKeyCommand("anthropic"), "golem auth set anthropic");
  const lines = pageKeyLines("anthropic", ASK_PAGE_KEY);
  assert.equal(lines[0]?.kind === "title" ? lines[0].text : "", "Anthropic · API key");
  assert.deepEqual(
    lines.filter((line) => line.kind === "option"),
    [{ kind: "option", label: "Check again", detail: "", selected: true }],
  );
});

test("Check again checks, Esc goes back, and the arrows do nothing", () => {
  assert.deepEqual(pressPageKey(ASK_PAGE_KEY, "enter"), { state: { phase: "checking" }, effect: { kind: "check" } });
  assert.deepEqual(pressPageKey(ASK_PAGE_KEY, "down"), { state: ASK_PAGE_KEY, effect: { kind: "none" } });
  assert.deepEqual(pressPageKey(ASK_PAGE_KEY, "back").effect, { kind: "back" });
  // A check already running is not started twice.
  assert.equal(pressPageKey({ phase: "checking" }, "enter").effect.kind, "none");
});

test("after a check the panel is done with a key, and says so without one", () => {
  assert.equal(pageKeyChecked(false), "done");
  assert.deepEqual(pageKeyChecked(true), { phase: "absent" });
  const absent = pageKeyLines("openai", { phase: "absent" });
  assert.ok(absent.some((line) => line.kind === "status" && line.mark === "attn" && line.text === "the key isn't there yet"));
  assert.ok(pageKeyLines("openai", { phase: "checking" }).some((line) => line.kind === "status" && line.mark === "spin"));
});

test("a key already saved shows Continue and no command, and Enter is done", () => {
  const saved = openPageKey(false);
  assert.deepEqual(saved, { phase: "saved" });
  assert.deepEqual(openPageKey(true), ASK_PAGE_KEY);
  const lines = pageKeyLines("openai", saved);
  assert.ok(lines.some((line) => line.kind === "status" && line.mark === "ok" && line.text === "Key saved for OpenAI."));
  assert.ok(!lines.some((line) => line.kind === "text"));
  assert.deepEqual(
    lines.filter((line) => line.kind === "option"),
    [{ kind: "option", label: "Continue", detail: "", selected: true }],
  );
  assert.deepEqual(pressPageKey(saved, "enter"), { state: saved, effect: { kind: "done" } });
  assert.equal(pressPageKey(saved, "back").effect.kind, "back");
});
