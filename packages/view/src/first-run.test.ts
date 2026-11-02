import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult } from "@golem/client";

import {
  firstRunChoice,
  localNeeds,
  modelChosen,
  namesModel,
  pressFirstRun,
  serviceStarted,
  startFirstRun,
  suggestedOption,
  type FirstRun,
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

test("a start waits for the service, then for the model list", () => {
  assert.deepEqual(startFirstRun(null, false), { step: "service" });
  assert.equal(startFirstRun(null, true), null);
  assert.deepEqual(startFirstRun(SET_UP, true), { step: "ready" });
  assert.deepEqual(startFirstRun({ ...SET_UP, default: null }, true), { step: "ready" });
  assert.deepEqual(startFirstRun(FRESH, true), { step: "choose", option: "local" });
});

test("a stored key suggests the API key path first", () => {
  assert.equal(suggestedOption(FRESH), "local");
  const keyed = { ...FRESH, setup: { ...FRESH.setup, keys: ["anthropic"] } };
  assert.equal(suggestedOption(keyed), "key");
  assert.deepEqual(startFirstRun(keyed, true), { step: "choose", option: "key" });
});

test("the local path says whether Ollama needs installing or starting", () => {
  assert.equal(localNeeds(FRESH), "start");
  assert.equal(localNeeds({ ...FRESH, setup: { ...FRESH.setup, ollama_installed: false } }), "install");
  assert.equal(localNeeds(SET_UP), null);
});

test("up and down move between the three choices and stop at the ends", () => {
  const start: FirstRun = { step: "choose", option: "local" };
  assert.deepEqual(pressFirstRun(start, "up"), start);
  const key = pressFirstRun(start, "down");
  assert.deepEqual(key, { step: "choose", option: "key" });
  const later = pressFirstRun(key, "down");
  assert.deepEqual(pressFirstRun(later, "down"), { step: "choose", option: "later" });
  assert.deepEqual(pressFirstRun(later, "up"), key);
  assert.deepEqual(pressFirstRun(start, "back"), start);
});

test("enter takes a path, later goes to the chat, and back returns to the same choice", () => {
  assert.deepEqual(pressFirstRun({ step: "choose", option: "local" }, "enter"), { step: "local" });
  assert.deepEqual(pressFirstRun({ step: "choose", option: "key" }, "enter"), { step: "key" });
  assert.deepEqual(pressFirstRun({ step: "choose", option: "later" }, "enter"), { step: "ready" });
  assert.deepEqual(pressFirstRun({ step: "key" }, "back"), { step: "choose", option: "key" });
  assert.deepEqual(pressFirstRun({ step: "local" }, "enter"), { step: "local" });
  assert.deepEqual(pressFirstRun({ step: "service" }, "enter"), { step: "service" });
});

test("the service starting and a model being chosen move the start on", () => {
  assert.deepEqual(serviceStarted({ step: "service" }, FRESH), { step: "choose", option: "local" });
  assert.equal(serviceStarted({ step: "service" }, null), null);
  assert.deepEqual(serviceStarted({ step: "key" }, FRESH), { step: "key" });
  assert.deepEqual(modelChosen({ step: "local" }), { step: "ready" });
  assert.deepEqual(modelChosen({ step: "service" }), { step: "service" });
});
