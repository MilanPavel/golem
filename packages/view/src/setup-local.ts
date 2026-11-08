import type { ListedModel, ModelListResult } from "@golem/client";

import { namesModel } from "./first-run.ts";
import { hostedProvider, recommendedHosted } from "./setup-key.ts";
import { formatElapsed } from "./duration.ts";
import { move, providerName, type Choice, type PanelKey, type SetupLine } from "./setup-window.ts";

/**
 * On this Mac: the Ollama panel (A5–A6′) and the Model panel (A7, A8, D2,
 * E3) of docs/design/setup-window.md. Pure, so the browser can draw the same.
 */

export const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

// Ollama

export type OllamaState =
  | { phase: "missing"; selected: number; note: string | null }
  | { phase: "installing"; since: number; last: string }
  | { phase: "starting"; since: number; installed: boolean }
  | { phase: "waiting"; since: number }
  | { phase: "failed"; reason: string; selected: number };

/** The panel as it opens: Ollama is missing, stopped (start it now), or running (nothing to do). */
export function ollamaAtOpen(listing: ModelListResult | null, now: number): OllamaState | "running" {
  if (listing?.setup.ollama_running === true) {
    return "running";
  }
  if (listing?.setup.ollama_installed === true) {
    return { phase: "starting", since: now, installed: false };
  }
  return { phase: "missing", selected: 0, note: null };
}

type OllamaChoice = "install" | "website";

function ollamaChoices(state: OllamaState): Choice<OllamaChoice>[] {
  const website = { id: "website", label: "Open ollama.com/download instead", detail: "" } as const;
  if (state.phase === "failed") {
    return [{ id: "install", label: "Retry", detail: "" }, website];
  }
  return [{ id: "install", label: "Install with Homebrew", detail: "" }, website];
}

export function ollamaLines(state: OllamaState, now: number): SetupLine[] {
  const head: SetupLine[] = [{ kind: "title", text: "On this Mac · Ollama" }, { kind: "blank" }];
  const options = (selected: number): SetupLine[] =>
    ollamaChoices(state).map((choice, index) => ({ kind: "option", label: choice.label, detail: "", selected: index === selected }));
  switch (state.phase) {
    case "missing":
      return [
        ...head,
        ...(state.note === null ? [] : [{ kind: "text", text: state.note, dim: true } as const]),
        { kind: "status", mark: "fail", text: "Ollama isn't installed" },
        { kind: "text", text: "Ollama runs the model on your Mac. About 200 MB.", dim: true },
        { kind: "blank" },
        ...options(state.selected),
      ];
    case "installing":
      return [
        ...head,
        { kind: "status", mark: "spin", text: "brew install ollama", right: formatElapsed(now - state.since) },
        { kind: "text", text: state.last.length > 0 ? state.last : "asking Homebrew…", dim: true },
      ];
    case "starting":
      return [
        ...head,
        ...(state.installed ? [{ kind: "status", mark: "ok", text: "Ollama installed" } as const] : []),
        { kind: "status", mark: "spin", text: "starting Ollama…", right: formatElapsed(now - state.since) },
      ];
    case "waiting":
      return [
        ...head,
        { kind: "text", text: "Opened ollama.com/download in your browser." },
        { kind: "text", text: "Install it, and golem continues on its own." },
        { kind: "blank" },
        { kind: "status", mark: "spin", text: "waiting for Ollama…", right: formatElapsed(now - state.since) },
      ];
    case "failed":
      return [
        ...head,
        { kind: "status", mark: "fail", text: "Ollama didn't install" },
        { kind: "text", text: state.reason, dim: true },
        { kind: "blank" },
        ...options(state.selected),
      ];
  }
}

export type OllamaEffect =
  | { kind: "none" }
  | { kind: "install" }
  | { kind: "website" }
  | { kind: "cancel" }
  | { kind: "back" };

export function pressOllama(state: OllamaState, key: PanelKey, now: number): { state: OllamaState; effect: OllamaEffect } {
  const none = { kind: "none" } as const;
  if (state.phase === "installing") {
    return { state, effect: key === "back" ? { kind: "cancel" } : none };
  }
  if (key === "back") {
    return { state, effect: { kind: "back" } };
  }
  if (state.phase !== "missing" && state.phase !== "failed") {
    return { state, effect: none };
  }
  const choices = ollamaChoices(state);
  if (key !== "enter") {
    return { state: { ...state, selected: move(state.selected, choices.length, key) }, effect: none };
  }
  if (choices[state.selected]?.id === "website") {
    return { state: { phase: "waiting", since: now }, effect: { kind: "website" } };
  }
  return { state: { phase: "installing", since: now, last: "" }, effect: { kind: "install" } };
}

/** How the daemon's install ended. No Homebrew sends the user to the website. */
export function ollamaInstallEnded(
  state: OllamaState,
  outcome: "installed" | "failed" | "stopped" | "no_brew",
  reason: string,
  now: number,
): OllamaState {
  switch (outcome) {
    case "installed":
      return { phase: "starting", since: now, installed: true };
    case "stopped":
      return { phase: "missing", selected: 0, note: "stopped the install" };
    case "no_brew":
      return { phase: "waiting", since: now };
    case "failed":
      return state.phase === "installing" || state.phase === "missing" || state.phase === "failed"
        ? { phase: "failed", reason, selected: 0 }
        : state;
  }
}

// Model

/** Which models the panel offers: local ones in guided mode, every ready engine's alone. */
export type ModelScope =
  | { kind: "local" }
  | { kind: "provider"; provider: string }
  | { kind: "all"; current: string | null }
  | { kind: "gone"; name: string };

export type ModelPanelState =
  | { phase: "pick"; selected: number; all: boolean }
  | { phase: "downloading"; ref: string; label: string; pull: PullTrack }
  | { phase: "failed"; ref: string; reason: string; selected: number; all: boolean };

export const START_MODEL_PANEL: ModelPanelState = { phase: "pick", selected: 0, all: false };

export type ModelChoice =
  | { kind: "model"; model: ListedModel; label: string; detail: string }
  | { kind: "all"; label: string };

/** How many rows show before "Show all". */
export const SHORT_LIST = 5;
/** How many rows the window shows at once of a long list. */
export const MAX_ROWS = 12;

const BLURBS: Record<string, string> = {
  coding: "good for code",
  reasoning: "thinks before it answers",
  fast: "quick for its size",
  small: "small and quick",
  general: "good all-round",
};

function sizeOf(model: ListedModel): string {
  return model.size_gb === null || model.size_gb === undefined ? "" : `${model.size_gb.toFixed(1)} GB`;
}

/** What the row says after the size: recommended, installed, too big, or what the model is good at. */
export function modelBlurb(model: ListedModel, ram: number | null, current: boolean): string {
  if (current) {
    return "current";
  }
  if (model.provider !== "ollama") {
    return providerName(model.provider);
  }
  const memory = ram === null ? "this Mac" : `${Math.round(ram)} GB`;
  if (model.fit === "too_big") {
    return `too big for ${memory}`;
  }
  if (model.status === "ready") {
    return "installed";
  }
  if (model.recommended === true) {
    return "recommended";
  }
  if (model.fit === "tight") {
    return `heavy for ${memory}`;
  }
  if (model.status === "pulling") {
    return "downloading";
  }
  const tag = (model.tags ?? []).find((each) => BLURBS[each] !== undefined);
  return tag === undefined ? "download" : (BLURBS[tag] ?? "");
}

function row(model: ListedModel, ram: number | null, current: boolean, label?: string): ModelChoice {
  const size = model.source === "catalog" || model.status === "ready" ? sizeOf(model) : "";
  const blurb = modelBlurb(model, ram, current);
  return {
    kind: "model",
    model,
    label: label ?? model.label,
    detail: size.length > 0 ? `${size.padStart(7)}   ${blurb}` : blurb,
  };
}

/** The recommended model first, then installed ones, then the rest by size. Too big ones last. */
function localOrder(models: readonly ListedModel[]): ListedModel[] {
  const rank = (model: ListedModel): number =>
    model.fit === "too_big" ? 4 : model.status === "ready" ? 1 : model.recommended === true ? 0 : model.fit === "tight" ? 3 : 2;
  return [...models].sort((a, b) => rank(a) - rank(b) || (a.size_gb ?? 0) - (b.size_gb ?? 0));
}

/** The rows the panel offers, with "Show all" when the short list leaves some out. */
export function modelChoices(listing: ModelListResult, scope: ModelScope, all: boolean): ModelChoice[] {
  const ram = listing.ram_gb ?? null;
  const local = listing.models.filter((model) => model.provider === "ollama" && model.source !== "profile");
  if (scope.kind === "local") {
    return shorten(localOrder(local).map((model) => row(model, ram, false)), all);
  }
  if (scope.kind === "provider") {
    const best = recommendedHosted(listing.models, scope.provider);
    const others = listing.models.filter((model) => model.provider === scope.provider && model.status === "ready" && model !== best);
    const rows: ModelChoice[] = [
      ...(best === null ? [] : [{ kind: "model", model: best, label: best.label, detail: "recommended" } as const]),
      ...others.map((model): ModelChoice => ({ kind: "model", model, label: model.label, detail: "" })),
    ];
    return shorten(rows, all);
  }
  if (scope.kind === "gone") {
    const named = listing.models.find((model) => namesModel(model, scope.name));
    const again: ModelChoice[] =
      named !== undefined && named.provider === "ollama" && named.status !== "ready"
        ? [{ kind: "model", model: named, label: `Download ${named.label} again`, detail: sizeOf(named) }]
        : [];
    const ready = listing.models.filter((model) => model.status === "ready" && model !== named);
    const rest = all ? localOrder(local.filter((model) => model.status !== "ready" && model !== named)) : [];
    const choices = [...again, ...ready.map((model) => row(model, ram, false)), ...rest.map((model) => row(model, ram, false))];
    return all ? choices : [...choices, { kind: "all", label: "Pick another model" }];
  }
  const current = listing.models.find((model) => namesModel(model, scope.current));
  const ready = listing.models.filter((model) => model.status === "ready" && model !== current);
  const download = localOrder(local.filter((model) => model.status !== "ready" && model !== current));
  const rows = [
    ...(current === undefined ? [] : [row(current, ram, true)]),
    ...ready.map((model) => row(model, ram, false)),
    ...download.map((model) => row(model, ram, false)),
  ];
  return shorten(rows, all);
}

function shorten(rows: ModelChoice[], all: boolean): ModelChoice[] {
  if (all || rows.length <= SHORT_LIST + 1) {
    return rows;
  }
  return [...rows.slice(0, SHORT_LIST), { kind: "all", label: `Show all ${rows.length} models` }];
}

/** The row Enter takes first: the current model, an installed one, else the recommended one. */
export function modelSelected(choices: readonly ModelChoice[]): number {
  const at = choices.findIndex((choice) => choice.kind === "model" && choice.model.status === "ready");
  return at < 0 ? 0 : at;
}

function title(listing: ModelListResult, scope: ModelScope): SetupLine[] {
  if (scope.kind === "gone") {
    const named = listing.models.find((model) => namesModel(model, scope.name));
    const where = named?.provider === "ollama" ? " in Ollama" : "";
    return [{ kind: "status", mark: "attn", text: `${scope.name} is no longer installed${where}.` }];
  }
  if (scope.kind === "provider") {
    return [{ kind: "title", text: `Pick a model · ${hostedProvider(scope.provider)?.name ?? scope.provider}` }];
  }
  if (scope.kind === "local") {
    const ram = listing.ram_gb === null || listing.ram_gb === undefined ? "" : ` · this Mac has ${Math.round(listing.ram_gb)} GB`;
    return [{ kind: "title", text: `Pick a model · Ollama${ram}` }];
  }
  const engines = [
    ...new Set(listing.models.filter((model) => model.status === "ready").map((model) => providerName(model.provider))),
  ];
  return [{ kind: "title", text: `Pick a model${engines.length > 0 ? ` · ${engines.join(" + ")}` : ""}` }];
}

/** The index of the first row a long list shows, so the selected one stays in view. */
export function firstShown(selected: number, count: number): number {
  return Math.max(0, Math.min(selected - Math.floor(MAX_ROWS / 2), count - MAX_ROWS));
}

export function modelLines(listing: ModelListResult | null, scope: ModelScope, state: ModelPanelState, now: number): SetupLine[] {
  if (state.phase === "downloading") {
    return [
      { kind: "status", mark: "spin", text: `downloading ${state.label}` },
      { kind: "text", text: pullLine(state.pull, now) },
    ];
  }
  if (listing === null) {
    return [{ kind: "status", mark: "spin", text: "listing the models…" }];
  }
  const choices = modelChoices(listing, scope, state.all);
  const lines: SetupLine[] = [...title(listing, scope), { kind: "blank" }];
  if (state.phase === "failed") {
    lines.push({ kind: "status", mark: "fail", text: `download of ${state.ref} failed` }, { kind: "text", text: state.reason, dim: true }, { kind: "blank" });
  }
  if (choices.length === 0) {
    lines.push({ kind: "text", text: "No model is ready yet. Add an API key, or pick On this Mac.", dim: true });
  }
  // A long list scrolls with the selection, so the window keeps its size.
  const first = firstShown(state.selected, choices.length);
  const shown = choices.slice(first, first + MAX_ROWS);
  if (first > 0) {
    lines.push({ kind: "text", text: `  ↑ ${first} more`, dim: true });
  }
  lines.push(
    ...shown.map(
      (choice, index): SetupLine => ({
        kind: "option",
        label: choice.label,
        detail: choice.kind === "model" ? choice.detail : "",
        selected: first + index === state.selected,
      }),
    ),
  );
  const after = choices.length - first - shown.length;
  if (after > 0) {
    lines.push({ kind: "text", text: `  ↓ ${after} more`, dim: true });
  }
  if (scope.kind === "local" && listing.disk_free_gb !== null && listing.disk_free_gb !== undefined) {
    lines.push({ kind: "blank" }, { kind: "text", text: `${Math.round(listing.disk_free_gb)} GB free on disk`, dim: true });
  }
  return lines;
}

export type ModelEffect =
  | { kind: "none" }
  | { kind: "choose"; model: ListedModel }
  | { kind: "pull"; model: ListedModel }
  | { kind: "background" }
  | { kind: "back" };

/**
 * One key on the Model panel. Enter on a ready model chooses it, on another
 * downloads it, and on Show all lists them all. Esc during a download keeps it
 * going and leaves for the chat.
 */
export function pressModel(
  listing: ModelListResult | null,
  scope: ModelScope,
  state: ModelPanelState,
  key: PanelKey,
  now: number,
): { state: ModelPanelState; effect: ModelEffect } {
  const none = { kind: "none" } as const;
  if (state.phase === "downloading") {
    return { state, effect: key === "back" ? { kind: "background" } : none };
  }
  if (key === "back") {
    return { state, effect: { kind: "back" } };
  }
  if (listing === null) {
    return { state, effect: none };
  }
  const choices = modelChoices(listing, scope, state.all);
  if (key !== "enter") {
    return { state: { ...state, selected: move(state.selected, choices.length, key) }, effect: none };
  }
  const choice = choices[state.selected];
  if (choice === undefined) {
    return { state, effect: none };
  }
  if (choice.kind === "all") {
    return { state: { phase: "pick", selected: state.selected, all: true }, effect: none };
  }
  const model = choice.model;
  if (model.status === "ready") {
    return { state, effect: { kind: "choose", model } };
  }
  if (model.provider !== "ollama" || model.fit === "too_big") {
    return { state, effect: none };
  }
  return {
    state: { phase: "downloading", ref: model.ref, label: model.label, pull: startPull(model, now) },
    effect: { kind: "pull", model },
  };
}

/** The download ended with an error: back to the list, saying why. */
export function modelPullFailed(state: ModelPanelState, reason: string): ModelPanelState {
  return state.phase === "downloading"
    ? { phase: "failed", ref: state.ref, reason, selected: 0, all: false }
    : state;
}

// Download progress, with its speed and time left

export type PullTrack = {
  completed: number;
  total: number | null;
  /** Recent byte counts, to measure the speed over the last few seconds. */
  samples: readonly { at: number; bytes: number }[];
};

const SPEED_WINDOW_MS = 8_000;

export function startPull(model: ListedModel, now: number): PullTrack {
  const total = model.size_gb === null || model.size_gb === undefined ? null : Math.round(model.size_gb * 1e9);
  return { completed: 0, total, samples: [{ at: now, bytes: 0 }] };
}

export function trackPull(track: PullTrack, completed: number | null, total: number | null, now: number): PullTrack {
  if (completed === null) {
    return track;
  }
  const samples = [...track.samples, { at: now, bytes: completed }].filter((sample) => now - sample.at <= SPEED_WINDOW_MS);
  return { completed, total: total ?? track.total, samples };
}

/** Bytes a second over the last few seconds, or null before there is enough to tell. */
export function pullSpeed(track: PullTrack): number | null {
  const first = track.samples[0];
  const last = track.samples.at(-1);
  if (first === undefined || last === undefined || last.at - first.at < 1_000 || last.bytes <= first.bytes) {
    return null;
  }
  return ((last.bytes - first.bytes) * 1000) / (last.at - first.at);
}

/** `██████░░░░░░` for a share between 0 and 1. */
export function progressBar(share: number, width = 18): string {
  const filled = Math.round(Math.min(1, Math.max(0, share)) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function gb(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

export function timeLeft(seconds: number): string {
  if (seconds < 60) {
    return "under a minute";
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** `██████░░░░░░░░░░░░  2.1 / 6.6 GB · 12 MB/s · 6 min`, with what is known so far. */
export function pullLine(track: PullTrack, _now: number, width = 18): string {
  const total = track.total;
  const parts: string[] = [];
  if (total !== null && total > 0) {
    parts.push(`${gb(track.completed)} / ${gb(total)} GB`);
  } else if (track.completed > 0) {
    parts.push(`${gb(track.completed)} GB`);
  }
  const speed = pullSpeed(track);
  if (speed !== null) {
    parts.push(`${Math.round(speed / 1e6)} MB/s`);
    if (total !== null && total > track.completed) {
      parts.push(timeLeft((total - track.completed) / speed));
    }
  }
  const bar = total !== null && total > 0 ? `${progressBar(track.completed / total, width)}  ` : "";
  return `${bar}${parts.length > 0 ? parts.join(" · ") : "starting…"}`;
}

/** The band while a download runs in the chat (A10′). */
export function pullBand(label: string, track: PullTrack): string {
  const total = track.total;
  const size = total !== null && total > 0 ? ` · ${gb(track.completed)} / ${gb(total)} GB` : "";
  const speed = pullSpeed(track);
  const left = speed !== null && total !== null && total > track.completed ? ` · ${timeLeft((total - track.completed) / speed)}` : "";
  return `downloading ${label}${size}${left} · /setup`;
}

// The band before the first token

/**
 * What the band says while a local model is not answering yet: Ollama is
 * starting, or the model is loading into memory. Null once the first token
 * came, or for a hosted model.
 */
export function warmingLine(input: {
  busy: boolean;
  answered: boolean;
  provider: string | null;
  label: string;
  serverStarting: boolean;
  cold: boolean;
}): string | null {
  if (!input.busy || input.answered || input.provider !== "ollama") {
    return null;
  }
  if (input.serverStarting) {
    return "starting Ollama…";
  }
  return input.cold ? `loading ${input.label}…` : null;
}
