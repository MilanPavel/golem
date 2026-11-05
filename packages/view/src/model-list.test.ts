import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult } from "@golem/client";

import {
  contextLabel,
  modelNames,
  pickerGroups,
  pickerModels,
  pickerName,
  keyMissing,
  priceLabel,
  providerMissing,
  sizeLabel,
  statusLabel,
  withPulls,
} from "./model-list.ts";

function model(ref: string, extra: Partial<ListedModel> = {}): ListedModel {
  return {
    ref,
    label: ref,
    provider: ref.slice(0, ref.indexOf("/")),
    source: "remote",
    status: "ready",
    ...extra,
  };
}

const LISTING: ModelListResult = {
  default: "qwen",
  ram_gb: 36,
  models: [
    model("ollama/qwen3:8b", { label: "Qwen3 8B", source: "installed", profiles: ["qwen"], price: { input: 0, output: 0 }, size_gb: 5.2, fit: "fits" }),
    model("ollama/gemma4:e4b", { source: "installed" }),
    model("ollama/qwen3:30b-a3b", {
      label: "Qwen3 30B-A3B",
      source: "catalog",
      status: "not_installed",
      price: { input: 0, output: 0 },
      size_gb: 18.6,
      fit: "tight",
    }),
    model("anthropic/claude-x", { source: "profile", status: "needs_key", profiles: ["sonnet"] }),
    model("openrouter/qwen/qwen3-235b", { label: "Qwen3 235B", price: { input: 0.2, output: 0.6 } }),
    model("openrouter/meta/llama-4"),
  ],
  providers: [
    { provider: "groq", status: "needs_key" },
    { provider: "ollama", status: "ready" },
  ],
  setup: { ollama_installed: true, ollama_running: true, keys: ["openrouter"], default_status: "ready" },
};

test("models are grouped: profiles, installed, download, then each provider", () => {
  const groups = pickerGroups(LISTING, "");
  assert.deepEqual(
    groups.map((group) => [group.title, group.models.map((item) => item.ref)]),
    [
      ["Profiles", ["ollama/qwen3:8b", "anthropic/claude-x"]],
      ["Installed", ["ollama/gemma4:e4b"]],
      ["Download", ["ollama/qwen3:30b-a3b"]],
      ["openrouter", ["openrouter/qwen/qwen3-235b", "openrouter/meta/llama-4"]],
    ],
  );
});

test("typing filters by ref, label, and profile name", () => {
  assert.deepEqual(
    pickerGroups(LISTING, "QWEN3").flatMap((group) => group.models.map((item) => item.ref)),
    ["ollama/qwen3:8b", "ollama/qwen3:30b-a3b", "openrouter/qwen/qwen3-235b"],
  );
  assert.deepEqual(pickerGroups(LISTING, "sonn").flatMap((group) => group.models.map((item) => item.ref)), [
    "anthropic/claude-x",
  ]);
  assert.deepEqual(pickerModels(null, ""), []);
  assert.equal(pickerModels(LISTING, "").length, 6);
});

test("suggested names are profiles, then ready refs", () => {
  assert.deepEqual(modelNames(LISTING), [
    "qwen",
    "sonnet",
    "ollama/qwen3:8b",
    "ollama/gemma4:e4b",
    "openrouter/qwen/qwen3-235b",
    "openrouter/meta/llama-4",
  ]);
  assert.deepEqual(modelNames(null), []);
});

test("the name to send is the first profile, else the ref", () => {
  assert.equal(pickerName(LISTING.models[0]!), "qwen");
  assert.equal(pickerName(LISTING.models[1]!), "ollama/gemma4:e4b");
});

test("live progress marks the row pulling, and a pull nobody listed gets a row", () => {
  const shown = withPulls(LISTING, {
    "ollama/qwen3:30b-a3b": { progress: 0.42, status: "pulling" },
    "ollama/other:1b": { progress: null, status: "starting" },
  });
  assert.ok(shown !== null);
  const row = shown.models.find((item) => item.ref === "ollama/qwen3:30b-a3b");
  assert.deepEqual([row?.status, row?.progress], ["pulling", 0.42]);
  const added = shown.models.find((item) => item.ref === "ollama/other:1b");
  assert.deepEqual([added?.status, added?.label, added?.provider], ["pulling", "other:1b", "ollama"]);
  assert.equal(withPulls(LISTING, {}), LISTING);
  assert.equal(withPulls(null, { "ollama/x:1b": { progress: null, status: "" } }), null);
});

test("a provider is missing when the listing says it is not installed", () => {
  const none = { ...LISTING, providers: [{ provider: "ollama", status: "not_installed" as const }] };
  assert.ok(providerMissing(none, "ollama"));
  assert.ok(!providerMissing(LISTING, "ollama"));
  assert.ok(!providerMissing(null, "ollama"));
});

test("the fact labels", () => {
  assert.equal(contextLabel(128000), "128k");
  assert.equal(contextLabel(512), "512");
  assert.equal(contextLabel(null), "");
  assert.equal(priceLabel(LISTING.models[0]!), "free");
  assert.equal(priceLabel(LISTING.models[4]!), "$0.2/0.6");
  assert.equal(priceLabel(LISTING.models[1]!), "$?");
  assert.equal(sizeLabel(LISTING.models[2]!), "18.6 GB tight");
  assert.equal(sizeLabel(LISTING.models[1]!), "");
  assert.equal(statusLabel(LISTING.models[2]!, false), "download");
  assert.equal(statusLabel(LISTING.models[2]!, true), "install");
  assert.equal(statusLabel(LISTING.models[3]!, false), "needs key");
  assert.equal(statusLabel(model("a/b", { status: "ready", stale: true }), false), "cached");
  assert.equal(statusLabel(model("a/b", { status: "pulling", progress: 0.425 }), false), "downloading 42%");
  assert.equal(statusLabel(model("a/b", { status: "pulling" }), false), "downloading");
  assert.equal(statusLabel(model("a/b", { status: "server_down" }), false), "down");
});

test("a key is missing while the provider needs one, is not listed, or there is no listing", () => {
  const listing: ModelListResult = {
    ...LISTING,
    providers: [
      { provider: "anthropic", status: "needs_key" },
      { provider: "openai", status: "ready" },
      { provider: "groq", status: "server_down" },
    ],
  };
  assert.ok(keyMissing(listing, "anthropic"));
  assert.ok(!keyMissing(listing, "openai"));
  assert.ok(!keyMissing(listing, "groq"));
  assert.ok(keyMissing(listing, "together"));
  assert.ok(keyMissing(null, "anthropic"));
  // A provider that is not installed is the other predicate's business.
  assert.ok(!providerMissing(listing, "anthropic"));
});
