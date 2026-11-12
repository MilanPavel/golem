import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult } from "@golem/client";

import {
  modelBlurb,
  modelChoices,
  modelLines,
  modelPullFailed,
  modelSelected,
  ollamaAtOpen,
  ollamaInstallEnded,
  ollamaLines,
  pressModel,
  pressOllama,
  progressBar,
  pullBand,
  pullLine,
  pullSpeed,
  START_MODEL_PANEL,
  startPull,
  trackPull,
  warmingLine,
  type ModelPanelState,
} from "./setup-local.ts";

function model(ref: string, extra: Partial<ListedModel> = {}): ListedModel {
  return { ref, label: ref, provider: ref.slice(0, ref.indexOf("/")), source: "catalog", status: "not_installed", fit: "fits", ...extra };
}

const LLAMA = model("ollama/llama3.2:3b", { label: "Llama 3.2 3B", size_gb: 2, tags: ["starter", "small"] });
const GEMMA = model("ollama/gemma4:e4b", { label: "Gemma 4 E4B", size_gb: 6.6, recommended: true, tags: ["starter"] });
const DEVSTRAL = model("ollama/devstral:24b", { label: "Devstral 24B", size_gb: 14.3, fit: "tight", tags: ["coding"] });
const HUGE = model("ollama/huge:70b", { label: "Huge 70B", size_gb: 40, fit: "too_big" });
const QWEN_CODER = model("ollama/qwen3-coder:30b", { label: "Qwen3 Coder 30B", size_gb: 18.6, tags: ["coding"] });
const REASON = model("ollama/gpt-oss:20b", { label: "gpt-oss 20B", size_gb: 13.8, tags: ["reasoning"] });
const CLAUDE = model("anthropic/claude-sonnet", { label: "Claude Sonnet", source: "remote", status: "ready", fit: null });

const LISTING: ModelListResult = {
  default: null,
  ram_gb: 36,
  disk_free_gb: 97.2,
  models: [LLAMA, GEMMA, REASON, DEVSTRAL, QWEN_CODER, HUGE],
  providers: [{ provider: "ollama", status: "ready" }],
  setup: { ollama_installed: true, ollama_running: true, keys: [], default_status: null },
};

test("the Ollama panel opens on missing, starts a stopped one, and skips a running one", () => {
  assert.equal(ollamaAtOpen(LISTING, 0), "running");
  const stopped = { ...LISTING, setup: { ...LISTING.setup, ollama_running: false } };
  assert.deepEqual(ollamaAtOpen(stopped, 5), { phase: "starting", since: 5, installed: false });
  const none = { ...LISTING, setup: { ...LISTING.setup, ollama_installed: false, ollama_running: false } };
  assert.deepEqual(ollamaAtOpen(none, 0), { phase: "missing", selected: 0, note: null });
  assert.deepEqual(ollamaAtOpen(null, 0), { phase: "missing", selected: 0, note: null });
  const stray = { ...none, setup: { ...none.setup, ollama_stray: true } };
  assert.deepEqual(ollamaAtOpen(stray, 0), { phase: "stray", selected: 0 });
});

test("a server left from a removed install says so, and Enter installs Ollama again", () => {
  const lines = ollamaLines({ phase: "stray", selected: 0 }, 0);
  assert.deepEqual(lines[2], { kind: "status", mark: "fail", text: "Ollama is still running from an install that was removed" });
  assert.deepEqual(pressOllama({ phase: "stray", selected: 0 }, "enter", 3).effect, { kind: "install" });
});

test("install shows brew's last line, Esc stops it, and the end moves the panel on", () => {
  const missing = { phase: "missing", selected: 0, note: null } as const;
  const installing = pressOllama(missing, "enter", 1_000);
  assert.deepEqual(installing.effect, { kind: "install" });
  const lines = ollamaLines({ phase: "installing", since: 1_000, last: "==> Downloading ollama" }, 42_000);
  assert.deepEqual(lines[2], { kind: "status", mark: "spin", text: "brew install ollama", right: "0m 41s" });
  assert.deepEqual(lines[3], { kind: "text", text: "==> Downloading ollama", dim: true });
  assert.deepEqual(pressOllama(installing.state, "back", 0).effect, { kind: "cancel" });
  assert.deepEqual(ollamaInstallEnded(installing.state, "installed", "", 9), { phase: "starting", since: 9, installed: true });
  assert.equal(ollamaInstallEnded(installing.state, "stopped", "", 9).phase, "missing");
  assert.deepEqual(ollamaInstallEnded(installing.state, "no_brew", "", 9), { phase: "waiting", since: 9 });
  assert.deepEqual(ollamaInstallEnded(installing.state, "failed", "Permission denied", 9), {
    phase: "failed",
    reason: "Permission denied",
    selected: 0,
  });
});

test("the website waits on its own, and a failed install offers retry or the website", () => {
  const missing = { phase: "missing", selected: 0, note: null } as const;
  const website = pressOllama(pressOllama(missing, "down", 0).state, "enter", 3);
  assert.deepEqual(website, { state: { phase: "waiting", since: 3 }, effect: { kind: "website" } });
  assert.ok(ollamaLines(website.state, 64_003).some((line) => line.kind === "status" && line.right === "1m 04s"));
  assert.deepEqual(pressOllama(website.state, "back", 0).effect, { kind: "back" });
  const failed = { phase: "failed", reason: "x", selected: 0 } as const;
  assert.deepEqual(pressOllama(failed, "enter", 0).effect, { kind: "install" });
});

test("the local list puts the recommended model first, then by size, too big last, with Show all", () => {
  const choices = modelChoices(LISTING, { kind: "local" }, false);
  assert.deepEqual(
    choices.map((choice) => choice.label),
    ["Gemma 4 E4B", "Llama 3.2 3B", "gpt-oss 20B", "Qwen3 Coder 30B", "Devstral 24B", "Huge 70B"],
  );
  const first = choices[0];
  assert.equal(first?.kind === "model" && first.detail, " 6.6 GB   recommended");
  const longer = { ...LISTING, models: [...LISTING.models, model("ollama/a:1b", { size_gb: 1 }), model("ollama/b:1b", { size_gb: 1 })] };
  const short = modelChoices(longer, { kind: "local" }, false);
  assert.equal(short.length, 6);
  assert.deepEqual(short.at(-1), { kind: "all", label: "Show all 8 models" });
  assert.equal(modelChoices(longer, { kind: "local" }, true).length, 8);
});

test("each row says what the model is good for, or why not", () => {
  assert.equal(modelBlurb(DEVSTRAL, 36, false), "heavy for 36 GB");
  assert.equal(modelBlurb(HUGE, 36, false), "too big for 36 GB");
  assert.equal(modelBlurb(QWEN_CODER, 36, false), "good for code");
  assert.equal(modelBlurb(REASON, 36, false), "thinks before it answers");
  assert.equal(modelBlurb({ ...LLAMA, status: "ready" }, 36, false), "installed");
  assert.equal(modelBlurb(CLAUDE, 36, false), "Anthropic");
  assert.equal(modelBlurb(CLAUDE, 36, true), "current");
});

test("the panel shows the Mac's memory and the free disk", () => {
  const lines = modelLines(LISTING, { kind: "local" }, START_MODEL_PANEL, 0);
  assert.deepEqual(lines[0], { kind: "title", text: "Pick a model · Ollama · this Mac has 36 GB" });
  assert.deepEqual(lines.at(-1), { kind: "text", text: "97 GB free on disk", dim: true });
});

test("Enter downloads a model, chooses a ready one, opens Show all, and refuses one too big", () => {
  const pressed = pressModel(LISTING, { kind: "local" }, START_MODEL_PANEL, "enter", 10);
  assert.deepEqual(pressed.effect, { kind: "pull", model: GEMMA });
  assert.equal(pressed.state.phase, "downloading");
  assert.deepEqual(pressModel(LISTING, { kind: "local" }, pressed.state, "back", 0).effect, { kind: "background" });
  const ready = { ...LISTING, models: [{ ...LLAMA, status: "ready" as const }] };
  assert.deepEqual(pressModel(ready, { kind: "local" }, START_MODEL_PANEL, "enter", 0).effect, {
    kind: "choose",
    model: { ...LLAMA, status: "ready" },
  });
  const tooBig: ModelPanelState = { phase: "pick", selected: 5, all: false };
  assert.deepEqual(pressModel(LISTING, { kind: "local" }, tooBig, "enter", 0).effect, { kind: "none" });
  assert.deepEqual(pressModel(LISTING, { kind: "local" }, START_MODEL_PANEL, "back", 0).effect, { kind: "back" });
  const failed = modelPullFailed(pressed.state, "disk full");
  assert.equal(failed.phase, "failed");
  assert.ok(modelLines(LISTING, { kind: "local" }, failed, 0).some((line) => line.kind === "text" && line.text === "disk full"));
});

test("alone, the panel lists every ready engine's models with the current one first", () => {
  const listing = { ...LISTING, models: [CLAUDE, { ...LLAMA, status: "ready" as const, source: "installed" as const }, GEMMA] };
  const choices = modelChoices(listing, { kind: "all", current: "ollama/llama3.2:3b" }, false);
  assert.deepEqual(
    choices.map((choice) => (choice.kind === "model" ? `${choice.label}|${choice.detail.trim()}` : choice.label)),
    ["Llama 3.2 3B|2.0 GB   current", "Claude Sonnet|Anthropic", "Gemma 4 E4B|6.6 GB   recommended"],
  );
  assert.deepEqual(modelLines(listing, { kind: "all", current: null }, START_MODEL_PANEL, 0)[0], {
    kind: "title",
    text: "Pick a model · Anthropic + Ollama",
  });
  assert.equal(modelSelected(choices), 0);
});

test("a default that is gone is named, with Download it again first", () => {
  const listing = { ...LISTING, models: [model("ollama/qwen3:8b", { label: "Qwen3 8B", size_gb: 5.2 }), { ...GEMMA, status: "ready" as const }] };
  const scope = { kind: "gone", name: "ollama/qwen3:8b" } as const;
  assert.deepEqual(modelLines(listing, scope, START_MODEL_PANEL, 0)[0], {
    kind: "status",
    mark: "attn",
    text: "ollama/qwen3:8b is no longer installed in Ollama.",
  });
  assert.deepEqual(
    modelChoices(listing, scope, false).map((choice) => choice.label),
    ["Download Qwen3 8B again", "Gemma 4 E4B", "Pick another model"],
  );
});

test("a download's line has the bar, the sizes, the speed, and the time left", () => {
  let track = startPull(GEMMA, 0);
  assert.equal(pullLine(track, 0), `${progressBar(0)}  0.0 / 6.6 GB`);
  track = trackPull(track, 1_000_000_000, 6_600_000_000, 2_000);
  track = trackPull(track, 2_100_000_000, 6_600_000_000, 4_000);
  assert.equal(Math.round((pullSpeed(track) ?? 0) / 1e6), 525);
  assert.match(pullLine(track, 4_000), /^█+░+ {2}2\.1 \/ 6\.6 GB · 525 MB\/s · under a minute$/);
  assert.equal(pullBand("Gemma 4 E4B", track), "downloading Gemma 4 E4B · 2.1 / 6.6 GB · under a minute · /setup");
  assert.equal(progressBar(0.5, 4), "██░░");
});

test("the band says Ollama is starting, then the model is loading, until the first token", () => {
  const base = { busy: true, answered: false, provider: "ollama", label: "Gemma 4 E4B", serverStarting: false, cold: true };
  assert.equal(warmingLine({ ...base, serverStarting: true }), "starting Ollama…");
  assert.equal(warmingLine(base), "loading Gemma 4 E4B…");
  assert.equal(warmingLine({ ...base, answered: true }), null);
  assert.equal(warmingLine({ ...base, cold: false }), null);
  assert.equal(warmingLine({ ...base, provider: "anthropic" }), null);
});
