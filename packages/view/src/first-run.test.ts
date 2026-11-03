import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult } from "@golem/client";

import {
  firstRunChoice,
  hostedProviders,
  namesModel,
  noModelChosen,
  recommendedLocal,
} from "./first-run.ts";

function model(ref: string, extra: Partial<ListedModel> = {}): ListedModel {
  return { ref, label: ref, provider: ref.slice(0, ref.indexOf("/")), source: "remote", status: "ready", ...extra };
}

const QWEN = model("ollama/qwen3:8b", { source: "installed", profiles: ["qwen"] });
const CATALOG = model("ollama/qwen3:30b-a3b", { source: "catalog", status: "not_installed" });
const CLAUDE = model("anthropic/claude-x", { source: "profile", status: "needs_key" });

/** A fresh ~/.golem: no default, Ollama installed and stopped, no keys. */
const FRESH: ModelListResult = {
  default: null,
  ram_gb: 36,
  models: [model("ollama/qwen3:8b", { source: "catalog", status: "server_down" }), CLAUDE],
  providers: [
    { provider: "anthropic", status: "needs_key" },
    { provider: "ollama", status: "server_down" },
  ],
  setup: { ollama_installed: true, ollama_running: false, keys: [], default_status: null },
};

const SET_UP: ModelListResult = {
  ...FRESH,
  default: "qwen",
  models: [QWEN, CATALOG, CLAUDE],
  setup: { ollama_installed: true, ollama_running: true, keys: [], default_status: "ready" },
};

test("namesModel matches a ref or a profile, never a null default", () => {
  assert.ok(namesModel(QWEN, "qwen"));
  assert.ok(namesModel(QWEN, "ollama/qwen3:8b"));
  assert.ok(!namesModel(QWEN, null));
});

test("a resolving default needs nothing, one ready model is used, else the user picks", () => {
  assert.equal(firstRunChoice(SET_UP), null);
  const unset = { ...SET_UP, default: null };
  assert.deepEqual(firstRunChoice(unset), { kind: "auto", model: QWEN });
  assert.deepEqual(firstRunChoice({ ...unset, models: [QWEN, model("ollama/gemma4:e4b")] }), { kind: "pick" });
  assert.deepEqual(firstRunChoice(FRESH), { kind: "pick" });
});

test("the card offers a ready local model, else the largest in a quarter of memory", () => {
  assert.equal(recommendedLocal(SET_UP), QWEN);
  const small = model("ollama/small:1b", { source: "catalog", status: "not_installed", size_gb: 1, fit: "fits" });
  const mid = model("ollama/mid:8b", { source: "catalog", status: "not_installed", size_gb: 5.2, fit: "fits" });
  const large = model("ollama/large:24b", { source: "catalog", status: "not_installed", size_gb: 14.3, fit: "fits" });
  const big = model("ollama/big:70b", { source: "catalog", status: "not_installed", size_gb: 40, fit: "too_big" });
  assert.equal(recommendedLocal({ ...FRESH, models: [small, mid, large, big, CLAUDE] }), mid);
  assert.equal(recommendedLocal({ ...FRESH, ram_gb: 16, models: [small, mid, large, CLAUDE] }), small);
  assert.equal(recommendedLocal({ ...FRESH, models: [big, CLAUDE] }), null);
});

test("hosted providers put the ones with a key first and leave Ollama out", () => {
  const listing: ModelListResult = {
    ...FRESH,
    providers: [
      { provider: "anthropic", status: "needs_key" },
      { provider: "groq", status: "ready" },
      { provider: "lmstudio", status: "unlisted" },
      { provider: "ollama", status: "server_down" },
      { provider: "openai", status: "needs_key" },
    ],
    setup: { ...FRESH.setup, keys: ["groq"] },
  };
  assert.deepEqual(hostedProviders(listing), ["groq", "anthropic", "openai"]);
});

test("only the never-chosen error reads as no model yet", () => {
  assert.ok(noModelChosen(-32005, "no model chosen yet", -32005));
  assert.ok(!noModelChosen(-32005, "unknown model: qwen", -32005));
  assert.ok(!noModelChosen(-32003, "no model chosen yet", -32005));
});
