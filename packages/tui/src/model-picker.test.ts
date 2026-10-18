import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult } from "@golem/client";

import type { Press, PressName } from "./keys.ts";
import {
  closedPicker,
  firstRunChoice,
  layoutPicker,
  modelNames,
  openPicker,
  pickerGroups,
  pickerKeyOf,
  pressPicker,
  unusableReason,
  type PickerState,
} from "./model-picker.ts";

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
};

function press(name: PressName | null, input = "", ctrl = false): Press {
  return { name, input, ctrl, meta: false };
}

function keyed(state: PickerState, ...presses: Press[]): PickerState {
  let current = state;
  for (const item of presses) {
    const key = pickerKeyOf(current, item);
    assert.ok(key !== null);
    current = pressPicker(current, LISTING, key).state;
  }
  return current;
}

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
});

test("Enter chooses the selection by profile name, else by ref", () => {
  const first = pressPicker(openPicker(null), LISTING, "enter");
  assert.deepEqual(first.action, { kind: "choose", model: LISTING.models[0], name: "qwen", setDefault: false });
  const moved = keyed(openPicker(null), press("down"), press("down"));
  const chosen = pressPicker(moved, LISTING, "enter").action;
  assert.ok(chosen.kind === "choose");
  assert.equal(chosen.name, "ollama/gemma4:e4b");
});

test("d makes the choice the default, but types a d once a filter is open", () => {
  const action = pressPicker(openPicker(null), LISTING, pickerKeyOf(openPicker(null), press(null, "d")) ?? "close").action;
  assert.ok(action.kind === "choose" && action.setDefault);
  const filtering = keyed(openPicker(null), press(null, "l"), press(null, "d"));
  assert.equal(filtering.query, "ld");
});

test("a first-run choice always sets the default", () => {
  const action = pressPicker(openPicker(null, true), LISTING, "enter").action;
  assert.ok(action.kind === "choose" && action.setDefault);
});

test("Esc clears the filter, then closes; Ctrl-R refreshes", () => {
  const filtered = keyed(openPicker(null), press(null, "x"));
  const cleared = keyed(filtered, press("escape"));
  assert.equal(cleared.query, "");
  assert.equal(cleared.open, true);
  assert.deepEqual(keyed(cleared, press("escape")), closedPicker);
  assert.deepEqual(pressPicker(cleared, LISTING, pickerKeyOf(cleared, press(null, "r", true)) ?? "close").action, {
    kind: "refresh",
  });
});

test("the selection is a ref and survives a reordered list", () => {
  const state = keyed(openPicker(null), press("down"));
  assert.equal(state.selected, "anthropic/claude-x");
  const reordered = { ...LISTING, models: [...LISTING.models].reverse() };
  const rows = layoutPicker({ state, listing: reordered, current: null, columns: 100, rows: 40 });
  const selected = rows.find((row) => row.kind === "model" && row.selected);
  assert.ok(selected?.kind === "model" && selected.ref === "anthropic/claude-x");
});

test("rows show profiles, facts, the current model, and provider notes", () => {
  const rows = layoutPicker({ state: openPicker(null), listing: LISTING, current: "qwen", columns: 100, rows: 40 });
  const qwen = rows.find((row) => row.kind === "model" && row.ref === "ollama/qwen3:8b");
  assert.ok(qwen?.kind === "model");
  assert.equal(qwen.label, "qwen");
  assert.equal(qwen.detail, "ollama/qwen3:8b");
  assert.equal(qwen.facts, "free  5.2 GB fits");
  assert.ok(qwen.current && qwen.selected);
  const download = rows.find((row) => row.kind === "model" && row.ref === "ollama/qwen3:30b-a3b");
  assert.ok(download?.kind === "model" && download.facts === "free  18.6 GB tight  download" && !download.ready);
  assert.deepEqual(rows.at(-1), { kind: "note", text: "groq: /login groq to list its models" });
});

test("a long list scrolls to keep the selection on screen", () => {
  const state = keyed(openPicker(null), press("page-down"));
  const rows = layoutPicker({ state, listing: LISTING, current: null, columns: 100, rows: 3 });
  assert.equal(rows.length, 3);
  assert.ok(rows.some((row) => row.kind === "model" && row.selected));
});

test("a model that cannot run says what to do", () => {
  assert.equal(unusableReason(LISTING.models[3]!), "needs key: /login anthropic");
  assert.match(unusableReason(LISTING.models[2]!) ?? "", /ollama pull qwen3:30b-a3b/);
  assert.equal(unusableReason(model("ollama/x", { status: "server_down" })), "Ollama is not answering: run ollama serve");
  assert.equal(unusableReason(LISTING.models[0]!), null);
});

test("first start: a resolving default needs nothing, one ready model is used, else the picker opens", () => {
  assert.equal(firstRunChoice(LISTING), null);
  const unset = { ...LISTING, default: "remote" };
  assert.deepEqual(firstRunChoice(unset), { kind: "pick" });
  const one = { ...unset, models: [LISTING.models[0]!, LISTING.models[2]!] };
  assert.deepEqual(firstRunChoice(one), { kind: "auto", model: LISTING.models[0] });
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
