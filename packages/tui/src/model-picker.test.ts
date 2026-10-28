import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult } from "@golem/client";

import type { Press, PressName } from "./keys.ts";
import {
  afterInstall,
  closedPicker,
  firstRunChoice,
  layoutPicker,
  modelNames,
  openPicker,
  pickerGroups,
  pickerHint,
  pickerKeyOf,
  pressPicker,
  providerMissing,
  unusableReason,
  withPulls,
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

test("a provider that is not installed says so", () => {
  const listing = { ...LISTING, providers: [{ provider: "ollama", status: "not_installed" as const }] };
  const rows = layoutPicker({ state: openPicker(null), listing, current: "qwen", columns: 100, rows: 40 });
  assert.deepEqual(rows.at(-1), { kind: "note", text: "ollama: not installed · Enter on one of its models installs it" });
});

test("a long list scrolls to keep the selection on screen", () => {
  const state = keyed(openPicker(null), press("page-down"));
  const rows = layoutPicker({ state, listing: LISTING, current: null, columns: 100, rows: 3 });
  assert.equal(rows.length, 3);
  assert.ok(rows.some((row) => row.kind === "model" && row.selected));
});

test("a model that cannot run says what to do", () => {
  assert.equal(unusableReason(LISTING.models[3]!), "needs key: /login anthropic");
  assert.match(unusableReason(LISTING.models[2]!) ?? "", /\/model pull qwen3:30b-a3b/);
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

function selecting(ref: string): PickerState {
  return { ...openPicker(null), selected: ref };
}

test("Enter on a model to download asks first, then downloads and uses it", () => {
  const asked = pressPicker(selecting("ollama/qwen3:30b-a3b"), LISTING, "enter");
  assert.equal(asked.action.kind, "none");
  assert.equal(asked.state.confirm?.kind, "pull");
  assert.equal(pickerHint(asked.state), "Download qwen3:30b-a3b (18.6 GB, tight) and use it? Enter downloads · Esc cancels");
  const done = pressPicker(asked.state, LISTING, "enter");
  assert.deepEqual(done.action, { kind: "pull", ref: "ollama/qwen3:30b-a3b", use: true, setDefault: false });
  assert.equal(done.state.confirm, null);
  const dropped = pressPicker(asked.state, LISTING, "close");
  assert.equal(dropped.state.confirm, null);
  assert.equal(dropped.state.open, true);
});

test("d on a model to download also makes it the default once it is in", () => {
  const asked = pressPicker(selecting("ollama/qwen3:30b-a3b"), LISTING, "default");
  const done = pressPicker(asked.state, LISTING, "enter");
  assert.deepEqual(done.action, { kind: "pull", ref: "ollama/qwen3:30b-a3b", use: true, setDefault: true });
});

test("a model too big for this machine asks twice", () => {
  const big = { ...LISTING, models: [model("ollama/huge:70b", { source: "catalog", status: "not_installed", size_gb: 40, fit: "too_big" })] };
  const first = pressPicker(openPicker(null), big, "enter");
  assert.match(pickerHint(first.state, 36), /too big for 36 GB of memory\. Enter again to download anyway/);
  const second = pressPicker(first.state, big, "enter");
  assert.equal(second.action.kind, "none");
  assert.equal(second.state.confirm?.step, 2);
  assert.equal(pressPicker(second.state, big, "enter").action.kind, "pull");
});

test("x stops a download, removes an installed model, and refuses the rest", () => {
  const pulling = withPulls(LISTING, { "ollama/qwen3:30b-a3b": { progress: 0.42, status: "pulling" } });
  const stop = pressPicker(selecting("ollama/qwen3:30b-a3b"), pulling, "remove");
  assert.equal(pickerHint(stop.state), "Stop downloading qwen3:30b-a3b? Enter stops · Esc keeps going");
  assert.deepEqual(pressPicker(stop.state, pulling, "enter").action, { kind: "cancel-pull", ref: "ollama/qwen3:30b-a3b" });
  const remove = pressPicker(selecting("ollama/gemma4:e4b"), LISTING, "remove");
  assert.deepEqual(pressPicker(remove.state, LISTING, "enter").action, { kind: "delete", ref: "ollama/gemma4:e4b" });
  assert.equal(pressPicker(selecting("openrouter/meta/llama-4"), LISTING, "remove").action.kind, "notice");
  assert.equal(pickerKeyOf(openPicker(null), press(null, "x")), "remove");
});

test("live progress shows on the row, and a pull nobody listed gets one", () => {
  const shown = withPulls(LISTING, {
    "ollama/qwen3:30b-a3b": { progress: 0.42, status: "pulling" },
    "ollama/other:1b": { progress: null, status: "starting" },
  });
  assert.ok(shown !== null);
  const rows = layoutPicker({ state: openPicker(null), listing: shown, current: null, columns: 100, rows: 40 });
  const row = rows.find((item) => item.kind === "model" && item.ref === "ollama/qwen3:30b-a3b");
  assert.ok(row?.kind === "model" && row.facts.endsWith("downloading 42%"));
  assert.ok(rows.some((item) => item.kind === "model" && item.ref === "ollama/other:1b"));
  assert.equal(withPulls(LISTING, {}), LISTING);
  const busy = pressPicker(selecting("ollama/qwen3:30b-a3b"), shown, "enter");
  assert.deepEqual(busy.action, { kind: "notice", text: "still downloading: x stops it" });
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

const NO_OLLAMA: ModelListResult = {
  default: "anthropic/claude-x",
  ram_gb: 36,
  models: [
    model("ollama/qwen3:8b", { source: "catalog", status: "server_down", size_gb: 5.2, fit: "fits" }),
    model("anthropic/claude-x"),
  ],
  providers: [
    { provider: "anthropic", status: "ready" },
    { provider: "ollama", status: "not_installed" },
  ],
};

test("a local model asks to install Ollama first when it is not installed", () => {
  assert.ok(providerMissing(NO_OLLAMA, "ollama"));
  assert.ok(!providerMissing(LISTING, "ollama"));
  const state = { ...openPicker(null), selected: "ollama/qwen3:8b" };
  const asked = pressPicker(state, NO_OLLAMA, "default");
  assert.equal(asked.action.kind, "none");
  assert.equal(asked.state.confirm?.kind, "install");
  assert.equal(
    pickerHint(asked.state),
    "Ollama isn't installed. Run brew install ollama now, then download qwen3:8b? Enter installs · Esc cancels",
  );
  const yes = pressPicker(asked.state, NO_OLLAMA, "enter");
  assert.deepEqual(yes.action, { kind: "install", ref: "ollama/qwen3:8b", setDefault: true });
  assert.equal(yes.state.confirm, null);
  const no = pressPicker(asked.state, NO_OLLAMA, "close");
  assert.deepEqual([no.action.kind, no.state.confirm, no.state.open], ["none", null, true]);
});

test("a hosted model never asks about Ollama", () => {
  const state = { ...openPicker(null), selected: "anthropic/claude-x" };
  assert.equal(pressPicker(state, NO_OLLAMA, "enter").action.kind, "choose");
});

test("after the install the picker asks to download, uses a ready model, or says why not", () => {
  const fresh: ModelListResult = {
    ...NO_OLLAMA,
    models: [model("ollama/qwen3:8b", { source: "catalog", status: "not_installed", size_gb: 5.2, fit: "fits" })],
    providers: [{ provider: "ollama", status: "ready" }],
  };
  const next = afterInstall(fresh, "ollama/qwen3:8b", true);
  assert.ok(next.kind === "confirm");
  assert.deepEqual(
    [next.confirm.kind, next.confirm.ref, next.confirm.use, next.confirm.setDefault],
    ["pull", "ollama/qwen3:8b", true, true],
  );

  const ready = { ...fresh, models: [model("ollama/qwen3:8b", { source: "installed" })] };
  assert.deepEqual(afterInstall(ready, "ollama/qwen3:8b", false), {
    kind: "choose",
    model: ready.models[0],
    name: "ollama/qwen3:8b",
    setDefault: false,
  });

  const down = { ...fresh, models: [model("ollama/qwen3:8b", { source: "catalog", status: "server_down" })] };
  assert.deepEqual(afterInstall(down, "ollama/qwen3:8b", false), {
    kind: "notice",
    text: "Ollama is installed, but it did not start: see ~/.golem/logs/ollama.log",
  });
  assert.deepEqual(afterInstall(NO_OLLAMA, "ollama/qwen3:8b", false), {
    kind: "notice",
    text: "Ollama is installed, but golem does not find it yet: Ctrl-R in /model looks again",
  });
  assert.deepEqual(afterInstall(fresh, "ollama/gone:1b", false), {
    kind: "notice",
    text: "Ollama is installed: /model to pick a model",
  });
});
