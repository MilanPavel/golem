import type { ListedModel, ModelListResult } from "@golem/client";

import type { Press } from "./keys.ts";

/** A question the picker asks before it downloads, stops, or removes. */
export type Confirm = {
  kind: "pull" | "cancel" | "delete";
  ref: string;
  sizeGb: number | null;
  fit: ListedModel["fit"];
  /** A model too big for this machine asks twice. */
  step: 1 | 2;
  /** Switch the session to it once the download ends. */
  use: boolean;
  setDefault: boolean;
};

/** The selection is a ref, so it stays put while a refreshed list reorders. */
export type PickerState = {
  open: boolean;
  selected: string | null;
  query: string;
  /** Opened because no model is configured. Choosing also sets the default. */
  firstRun: boolean;
  confirm: Confirm | null;
};

export const closedPicker: PickerState = { open: false, selected: null, query: "", firstRun: false, confirm: null };

/** A download in progress, from `model.pull.progress`. */
export type PullState = { progress: number | null; status: string };

export type PickerKey =
  | "up"
  | "down"
  | "page-up"
  | "page-down"
  | "enter"
  | "default"
  | "backspace"
  | "clear-query"
  | "close"
  | "refresh"
  | "remove"
  | { kind: "type"; text: string };

export type PickerAction =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "refresh" }
  | { kind: "notice"; text: string }
  | { kind: "choose"; model: ListedModel; name: string; setDefault: boolean }
  | { kind: "pull"; ref: string; use: boolean; setDefault: boolean }
  | { kind: "cancel-pull"; ref: string }
  | { kind: "delete"; ref: string };

export type PickerRow =
  | { kind: "header"; text: string }
  | { kind: "note"; text: string }
  | {
      kind: "model";
      ref: string;
      selected: boolean;
      current: boolean;
      ready: boolean;
      label: string;
      detail: string;
      facts: string;
    };

type Group = { title: string; models: ListedModel[] };

const QUERY_MAX = 200;
const PAGE = 10;

export function openPicker(current: string | null, firstRun = false, confirm: Confirm | null = null): PickerState {
  return { open: true, selected: confirm?.ref ?? current, query: "", firstRun, confirm };
}

/** The listing with live download progress laid over it. */
export function withPulls(listing: ModelListResult | null, pulls: Readonly<Record<string, PullState>>): ModelListResult | null {
  if (listing === null) {
    return null;
  }
  const refs = Object.keys(pulls);
  if (refs.length === 0) {
    return listing;
  }
  const known = new Set(listing.models.map((model) => model.ref));
  const models = listing.models.map((model) => {
    const pull = pulls[model.ref];
    return pull === undefined ? model : { ...model, status: "pulling" as const, progress: pull.progress };
  });
  for (const ref of refs.filter((item) => !known.has(item))) {
    models.push({
      ref,
      label: ref.slice(ref.indexOf("/") + 1),
      provider: ref.slice(0, ref.indexOf("/")),
      source: "catalog",
      status: "pulling",
      progress: pulls[ref]?.progress ?? null,
      price: { input: 0, output: 0 },
    });
  }
  return { ...listing, models };
}

/** The name to send for a model: its first profile, else its ref. */
export function pickerName(model: ListedModel): string {
  return model.profiles?.[0] ?? model.ref;
}

/** Names `/model ` suggests: profiles first, then ready refs. */
export function modelNames(listing: ModelListResult | null): string[] {
  if (listing === null) {
    return [];
  }
  const profiles = listing.models.flatMap((model) => model.profiles ?? []);
  const refs = listing.models.filter((model) => model.status === "ready").map((model) => model.ref);
  return [...new Set([...profiles.sort(), ...refs])];
}

/** True when `name` is the ref or a profile of `model`. */
export function namesModel(model: ListedModel, name: string | null): boolean {
  return name !== null && (model.ref === name || (model.profiles ?? []).includes(name));
}

/**
 * What a first start does. `null` when the default resolves. With no default,
 * one ready model is used without asking; otherwise the picker opens.
 */
export function firstRunChoice(listing: ModelListResult): { kind: "auto"; model: ListedModel } | { kind: "pick" } | null {
  if (listing.models.some((model) => namesModel(model, listing.default))) {
    return null;
  }
  const ready = listing.models.filter((model) => model.status === "ready");
  const only = ready[0];
  if (ready.length === 1 && only !== undefined) {
    return { kind: "auto", model: only };
  }
  return { kind: "pick" };
}

/** Why a model cannot be used yet, or null when it can. */
export function unusableReason(model: ListedModel): string | null {
  const id = model.ref.slice(model.ref.indexOf("/") + 1);
  switch (model.status) {
    case "ready":
      return null;
    case "needs_key":
      return `needs key: /login ${model.provider}`;
    case "not_installed":
      return `not installed: /model pull ${id} downloads it`;
    case "pulling":
      return `still downloading ${id}`;
    case "server_down":
      return model.provider === "ollama" ? "Ollama is not answering: run ollama serve" : `${model.provider} is not answering`;
  }
}

/** Groups in display order, filtered by `query` on ref, label, and profile names. */
export function pickerGroups(listing: ModelListResult, query: string): Group[] {
  const needle = query.toLowerCase();
  const matches = (model: ListedModel): boolean =>
    needle.length === 0 ||
    model.ref.toLowerCase().includes(needle) ||
    model.label.toLowerCase().includes(needle) ||
    (model.profiles ?? []).some((name) => name.toLowerCase().includes(needle));
  const shown = listing.models.filter(matches);
  const profiled = shown.filter((model) => (model.profiles ?? []).length > 0 || model.source === "profile");
  const rest = shown.filter((model) => !profiled.includes(model));
  const groups: Group[] = [
    { title: "Profiles", models: profiled },
    { title: "Installed", models: rest.filter((model) => model.source === "installed") },
    { title: "Download", models: rest.filter((model) => model.source === "catalog") },
  ];
  const providers = [...new Set(rest.filter((model) => model.source === "remote").map((model) => model.provider))];
  for (const provider of providers.sort()) {
    groups.push({ title: provider, models: rest.filter((model) => model.source === "remote" && model.provider === provider) });
  }
  return groups.filter((group) => group.models.length > 0);
}

/** Every selectable model, in display order. */
export function pickerModels(listing: ModelListResult | null, query: string): ListedModel[] {
  return listing === null ? [] : pickerGroups(listing, query).flatMap((group) => group.models);
}

export function pickerHint(state: PickerState, ramGb: number | null = null): string {
  const confirm = state.confirm;
  if (confirm !== null) {
    return confirmHint(confirm, ramGb);
  }
  if (state.query.length > 0) {
    return `filter: ${state.query}  ↑↓ move · Enter use · Esc clear`;
  }
  const head = state.firstRun ? "Pick a model to start. " : "";
  return `${head}↑↓ move · Enter use or download · d also make default · x stop or remove · type to filter · Ctrl-R refresh · Esc close`;
}

function confirmHint(confirm: Confirm, ramGb: number | null): string {
  const name = confirm.ref.slice(confirm.ref.indexOf("/") + 1);
  if (confirm.kind === "cancel") {
    return `Stop downloading ${name}? Enter stops · Esc keeps going`;
  }
  if (confirm.kind === "delete") {
    return `Remove ${name} from Ollama? Enter removes · Esc keeps it`;
  }
  const size = confirm.sizeGb === null ? "size unknown" : `${confirm.sizeGb} GB`;
  if (confirm.fit === "too_big" && confirm.step === 1) {
    const memory = ramGb === null ? "this Mac" : `${ramGb} GB of memory`;
    return `${name} (${size}) is too big for ${memory}. Enter again to download anyway · Esc cancels`;
  }
  const fit = confirm.fit === null || confirm.fit === undefined ? "" : `, ${confirm.fit === "too_big" ? "too big" : confirm.fit}`;
  const after = confirm.use ? " and use it" : "";
  return `Download ${name} (${size}${fit})${after}? Enter downloads · Esc cancels`;
}

/** Map a key press to a picker key. `d` is the default key only while nothing is typed. */
export function pickerKeyOf(state: PickerState, press: Press): PickerKey | null {
  switch (press.name) {
    case "up":
      return "up";
    case "down":
      return "down";
    case "page-up":
      return "page-up";
    case "page-down":
      return "page-down";
    case "return":
      return "enter";
    case "backspace":
      return "backspace";
    case "escape":
      return state.query.length > 0 ? "clear-query" : "close";
    case "ctrl-c":
      return "close";
    default:
      break;
  }
  if (press.ctrl && press.input === "r") {
    return "refresh";
  }
  if (press.ctrl || press.meta || press.input.length === 0 || /[\r\n]/.test(press.input)) {
    return null;
  }
  if (press.input === "d" && state.query.length === 0) {
    return "default";
  }
  if (press.input === "x" && state.query.length === 0) {
    return "remove";
  }
  return { kind: "type", text: press.input };
}

function onConfirm(state: PickerState, key: PickerKey): { state: PickerState; action: PickerAction } {
  const confirm = state.confirm;
  if (confirm === null) {
    return { state, action: { kind: "none" } };
  }
  if (key === "close" || key === "clear-query") {
    return { state: { ...state, confirm: null }, action: { kind: "none" } };
  }
  if (key !== "enter") {
    return { state, action: { kind: "none" } };
  }
  if (confirm.kind === "pull" && confirm.fit === "too_big" && confirm.step === 1) {
    return { state: { ...state, confirm: { ...confirm, step: 2 } }, action: { kind: "none" } };
  }
  const next = { ...state, confirm: null };
  if (confirm.kind === "cancel") {
    return { state: next, action: { kind: "cancel-pull", ref: confirm.ref } };
  }
  if (confirm.kind === "delete") {
    return { state: next, action: { kind: "delete", ref: confirm.ref } };
  }
  return { state: next, action: { kind: "pull", ref: confirm.ref, use: confirm.use, setDefault: confirm.setDefault } };
}

/** The question for a model the picker cannot simply use. */
export function confirmFor(kind: Confirm["kind"], model: ListedModel, setDefault = false): Confirm {
  return {
    kind,
    ref: model.ref,
    sizeGb: model.size_gb ?? null,
    fit: model.fit ?? null,
    step: 1,
    use: kind === "pull",
    setDefault,
  };
}

export function pressPicker(
  state: PickerState,
  listing: ModelListResult | null,
  key: PickerKey,
): { state: PickerState; action: PickerAction } {
  if (state.confirm !== null) {
    return onConfirm(state, key);
  }
  if (key === "close") {
    return { state: closedPicker, action: { kind: "close" } };
  }
  if (key === "refresh") {
    return { state, action: { kind: "refresh" } };
  }
  if (key === "clear-query") {
    return { state: { ...state, query: "" }, action: { kind: "none" } };
  }
  if (key === "backspace") {
    return { state: { ...state, query: [...state.query].slice(0, -1).join("") }, action: { kind: "none" } };
  }
  if (typeof key === "object") {
    return { state: { ...state, query: (state.query + key.text).slice(0, QUERY_MAX) }, action: { kind: "none" } };
  }
  const models = pickerModels(listing, state.query);
  const index = selectedIndex(state, models);
  if (key === "enter" || key === "default" || key === "remove") {
    const chosen = models[index];
    if (chosen === undefined) {
      return { state, action: { kind: "none" } };
    }
    const setDefault = key === "default" || state.firstRun;
    if (key === "remove") {
      if (chosen.status === "pulling") {
        return { state: { ...state, confirm: confirmFor("cancel", chosen) }, action: { kind: "none" } };
      }
      if (chosen.source === "installed" && chosen.provider === "ollama") {
        return { state: { ...state, confirm: confirmFor("delete", chosen) }, action: { kind: "none" } };
      }
      return { state, action: { kind: "notice", text: "only a downloaded local model can be removed" } };
    }
    if (chosen.status === "not_installed") {
      return { state: { ...state, confirm: confirmFor("pull", chosen, setDefault) }, action: { kind: "none" } };
    }
    if (chosen.status === "pulling") {
      return { state, action: { kind: "notice", text: "still downloading: x stops it" } };
    }
    return { state, action: { kind: "choose", model: chosen, name: pickerName(chosen), setDefault } };
  }
  const step = key === "up" ? -1 : key === "down" ? 1 : key === "page-up" ? -PAGE : PAGE;
  const next = models[Math.min(Math.max(index + step, 0), Math.max(0, models.length - 1))];
  return { state: { ...state, selected: next?.ref ?? null }, action: { kind: "none" } };
}

/** Headers, models, and the provider notes, at most `rows` lines, scrolled to the selection. */
export function layoutPicker(input: {
  state: PickerState;
  listing: ModelListResult | null;
  current: string | null;
  columns: number;
  rows: number;
}): PickerRow[] {
  const { listing, rows } = input;
  if (rows <= 0) {
    return [];
  }
  if (listing === null) {
    return [{ kind: "note", text: "Loading models…" }];
  }
  const models = pickerModels(listing, input.state.query);
  const index = selectedIndex(input.state, models);
  const selectedRef = models[index]?.ref ?? null;
  const lines: PickerRow[] = [];
  for (const group of pickerGroups(listing, input.state.query)) {
    lines.push({ kind: "header", text: group.title });
    for (const model of group.models) {
      lines.push(modelRow(model, model.ref === selectedRef, namesModel(model, input.current), input.columns));
    }
  }
  if (models.length === 0) {
    lines.push({ kind: "note", text: input.state.query.length > 0 ? "No matching models." : "No models found." });
  }
  for (const provider of listing.providers) {
    if (provider.status === "needs_key") {
      lines.push({ kind: "note", text: `${provider.provider}: /login ${provider.provider} to list its models` });
    } else if (provider.status === "server_down") {
      lines.push({ kind: "note", text: `${provider.provider}: not answering` });
    } else if (provider.status === "not_installed") {
      lines.push({ kind: "note", text: `${provider.provider}: not installed` });
    }
  }
  const at = lines.findIndex((line) => line.kind === "model" && line.selected);
  const start = Math.min(Math.max(0, at - rows + 2), Math.max(0, lines.length - rows));
  return lines.slice(start, start + rows);
}

function modelRow(model: ListedModel, selected: boolean, current: boolean, columns: number): PickerRow {
  const facts = [contextLabel(model.ctx), priceLabel(model), sizeLabel(model), statusLabel(model)]
    .filter((part) => part.length > 0)
    .join("  ");
  const profiles = model.profiles ?? [];
  const label = profiles.length > 0 ? profiles.join(", ") : model.label;
  const detail = profiles.length > 0 || model.label !== model.ref ? model.ref : "";
  const room = Math.max(0, columns - facts.length - 6);
  const fittedLabel = fit(label, room);
  return {
    kind: "model",
    ref: model.ref,
    selected,
    current,
    ready: model.status === "ready",
    label: fittedLabel,
    detail: fit(detail, Math.max(0, room - fittedLabel.length - 2)),
    facts,
  };
}

function contextLabel(ctx: number | null | undefined): string {
  if (ctx === null || ctx === undefined) {
    return "";
  }
  return ctx >= 1000 ? `${Math.round(ctx / 1000)}k` : String(ctx);
}

function priceLabel(model: ListedModel): string {
  const price = model.price;
  if (price === null || price === undefined) {
    return "$?";
  }
  if (price.input === 0 && price.output === 0) {
    return "free";
  }
  return `$${trim(price.input)}/${trim(price.output)}`;
}

function sizeLabel(model: ListedModel): string {
  if (model.size_gb === null || model.size_gb === undefined) {
    return "";
  }
  const fitText = model.fit === "too_big" ? " too big" : model.fit === "tight" ? " tight" : model.fit === "fits" ? " fits" : "";
  return `${model.size_gb} GB${fitText}`;
}

function statusLabel(model: ListedModel): string {
  switch (model.status) {
    case "ready":
      return model.stale ? "cached" : "";
    case "needs_key":
      return "needs key";
    case "not_installed":
      return "download";
    case "pulling":
      return model.progress === null || model.progress === undefined
        ? "downloading"
        : `downloading ${Math.floor(model.progress * 100)}%`;
    case "server_down":
      return "down";
  }
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "");
}

function selectedIndex(state: PickerState, models: readonly ListedModel[]): number {
  const found = models.findIndex((model) => model.ref === state.selected);
  return found < 0 ? 0 : found;
}

function fit(text: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
