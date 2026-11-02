import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult } from "@golem/client";

import type { Press, PressName } from "./keys.ts";
import { layoutWelcome, welcomeKeyOf, WELCOME_HINT } from "./welcome.ts";

function model(ref: string, extra: Partial<ListedModel> = {}): ListedModel {
  return { ref, label: ref, provider: ref.slice(0, ref.indexOf("/")), source: "remote", status: "ready", ...extra };
}

function press(name: PressName | null, input = ""): Press {
  return { name, input, ctrl: false, meta: false };
}

const FRESH: ModelListResult = {
  default: null,
  ram_gb: 36,
  models: [
    model("ollama/qwen3:8b", { label: "Qwen3 8B", source: "catalog", status: "not_installed", size_gb: 5.2, fit: "fits" }),
    model("anthropic/claude-x", { source: "profile", status: "needs_key" }),
  ],
  providers: [
    { provider: "anthropic", status: "needs_key" },
    { provider: "ollama", status: "not_installed" },
    { provider: "openai", status: "needs_key" },
  ],
  setup: { ollama_installed: false, ollama_running: false, keys: [], default_status: null },
};

test("the card names the model, its size, the Ollama install, and the providers", () => {
  const rows = layoutWelcome("local", FRESH);
  assert.deepEqual(rows[0], { kind: "title", text: "Welcome to golem. How should it think?" });
  const options = rows.filter((row) => row.kind === "option");
  assert.deepEqual(options, [
    { kind: "option", label: "On this Mac", detail: "private, free · Qwen3 8B · 5.2 GB · installs Ollama", selected: true },
    { kind: "option", label: "With an API key", detail: "Anthropic, OpenAI", selected: false },
    { kind: "option", label: "Later", detail: "/model any time", selected: false },
  ]);
  assert.deepEqual(rows.at(-1), { kind: "hint", text: WELCOME_HINT });
});

test("a ready local model says so, and no fitting model says to pick one", () => {
  const ready = { ...FRESH, models: [model("ollama/qwen3:8b", { label: "Qwen3 8B", source: "installed" })] };
  const local = (listing: ModelListResult) => layoutWelcome("key", listing).find((row) => row.kind === "option");
  assert.deepEqual(local(ready), { kind: "option", label: "On this Mac", detail: "private, free · Qwen3 8B, ready", selected: false });
  assert.equal((local({ ...FRESH, models: [] }) as { detail: string }).detail, "private, free · pick a model that fits");
});

test("arrows move, Enter picks, Esc and Ctrl-C choose later, letters do nothing", () => {
  assert.equal(welcomeKeyOf(press("up")), "up");
  assert.equal(welcomeKeyOf(press("down")), "down");
  assert.equal(welcomeKeyOf(press("return")), "enter");
  assert.equal(welcomeKeyOf(press("escape")), "later");
  assert.equal(welcomeKeyOf(press("ctrl-c")), "later");
  assert.equal(welcomeKeyOf(press(null, "x")), null);
});
