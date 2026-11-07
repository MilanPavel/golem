import type { ListedModel, ModelListResult } from "@golem/client";
import {
  CATEGORIES,
  categoriesLabel,
  categoryName,
  contextLabel,
  modelNames,
  namesModel,
  nextCategory,
  previousCategory,
  pickerGroups,
  pickerModels,
  pickerName,
  priceLabel,
  providerMissing,
  sizeLabel,
  statusLabel,
  withPulls,
  type Category,
  type PullState,
} from "@golem/view";

import type { Press } from "./keys.ts";

/** A question the picker asks before it installs Ollama, downloads, stops, or removes. */
export type Confirm = {
  kind: "install" | "pull" | "cancel" | "delete";
  ref: string;
  sizeGb: number | null;
  fit: ListedModel["fit"];
  /** A model too big for this machine asks twice. */
  step: 1 | 2;
  /** Switch the session to it once the download ends. */
  use: boolean;
  setDefault: boolean;
};

export { modelNames, pickerGroups, pickerName, providerMissing, withPulls, type PullState };

/** The selection is a ref, so it stays put while a refreshed list reorders. */
export type PickerState = {
  open: boolean;
  selected: string | null;
  query: string;
  /** Opened because no model is configured. Choosing also sets the default. */
  firstRun: boolean;
  confirm: Confirm | null;
  /** The list shows every live chat model that calls tools, not only the catalog's. */
  showAll: boolean;
  /** Only models of this category are listed, or all of them when null. */
  category: Category | null;
};

export const closedPicker: PickerState = {
  open: false,
  selected: null,
  query: "",
  firstRun: false,
  confirm: null,
  showAll: false,
  category: null,
};

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
  | "show-all"
  | "category"
  | "category-back"
  | "remove"
  | { kind: "type"; text: string };

export type PickerAction =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "refresh" }
  | { kind: "show-all"; on: boolean }
  | { kind: "notice"; text: string }
  | { kind: "choose"; model: ListedModel; name: string; setDefault: boolean }
  | { kind: "pull"; ref: string; use: boolean; setDefault: boolean }
  | { kind: "install"; ref: string; setDefault: boolean }
  | { kind: "cancel-pull"; ref: string }
  | { kind: "delete"; ref: string };

export type PickerRow =
  | { kind: "tabs"; tabs: { label: string; active: boolean }[] }
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

const QUERY_MAX = 200;
const PAGE = 10;

export function openPicker(
  current: string | null,
  firstRun = false,
  confirm: Confirm | null = null,
  showAll = false,
): PickerState {
  return { open: true, selected: confirm?.ref ?? current, query: "", firstRun, confirm, showAll, category: null };
}

/** What follows a finished install, once the model list is fresh: download, use, or say why not. */
export type AfterInstall =
  | { kind: "confirm"; confirm: Confirm }
  | { kind: "choose"; model: ListedModel; name: string; setDefault: boolean }
  | { kind: "notice"; text: string };

export function afterInstall(listing: ModelListResult, ref: string, setDefault: boolean): AfterInstall {
  const model = listing.models.find((item) => item.ref === ref);
  const provider = ref.slice(0, ref.indexOf("/"));
  if (providerMissing(listing, provider)) {
    return { kind: "notice", text: "Ollama is installed, but golem does not find it yet: Ctrl-R in /model looks again" };
  }
  if (model === undefined) {
    return { kind: "notice", text: "Ollama is installed: /model to pick a model" };
  }
  switch (model.status) {
    case "not_installed":
      return { kind: "confirm", confirm: confirmFor("pull", model, setDefault) };
    case "ready":
      return { kind: "choose", model, name: pickerName(model), setDefault };
    case "pulling":
      return { kind: "notice", text: `Ollama is installed, and ${ref} is downloading` };
    case "needs_key":
    case "server_down":
      return { kind: "notice", text: "Ollama is installed, but it did not start: see ~/.golem/logs/ollama.log" };
  }
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

export function pickerHint(state: PickerState, ramGb: number | null = null): string {
  const confirm = state.confirm;
  if (confirm !== null) {
    return confirmHint(confirm, ramGb);
  }
  if (state.query.length > 0) {
    return `filter: ${state.query}  ↑↓ move · Enter use · Tab category · Esc clear`;
  }
  const head = state.firstRun ? "Pick a model to start. " : "";
  const all = state.showAll ? "Ctrl-A current only" : "Ctrl-A show all";
  return `${head}↑↓ move · Enter use or download · d also make default · x stop or remove · type to filter · Tab category · ${all} · Ctrl-R refresh · Esc close`;
}

function confirmHint(confirm: Confirm, ramGb: number | null): string {
  const name = confirm.ref.slice(confirm.ref.indexOf("/") + 1);
  if (confirm.kind === "install") {
    return `Ollama isn't installed. Run brew install ollama now, then download ${name}? Enter installs · Esc cancels`;
  }
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
    case "tab":
      return press.shift === true ? "category-back" : "category";
    case "left":
      return "category-back";
    case "right":
      return "category";
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
  if (press.ctrl && press.input === "a") {
    return "show-all";
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
  if (confirm.kind === "install") {
    return { state: next, action: { kind: "install", ref: confirm.ref, setDefault: confirm.setDefault } };
  }
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
  if (key === "show-all") {
    return { state: { ...state, showAll: !state.showAll }, action: { kind: "show-all", on: !state.showAll } };
  }
  if (key === "category" || key === "category-back") {
    const category = key === "category" ? nextCategory(state.category) : previousCategory(state.category);
    return { state: { ...state, category }, action: { kind: "none" } };
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
  const models = pickerModels(listing, state.query, state.category);
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
    if (chosen.status !== "ready" && providerMissing(listing, chosen.provider)) {
      return { state: { ...state, confirm: confirmFor("install", chosen, setDefault) }, action: { kind: "none" } };
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
  const { query, category } = input.state;
  const models = pickerModels(listing, query, category);
  const index = selectedIndex(input.state, models);
  const selectedRef = models[index]?.ref ?? null;
  const lines: PickerRow[] = [];
  for (const group of pickerGroups(listing, query, category)) {
    lines.push({ kind: "header", text: group.title });
    for (const model of group.models) {
      const missing = providerMissing(listing, model.provider);
      lines.push(modelRow(model, model.ref === selectedRef, namesModel(model, input.current), input.columns, missing));
    }
  }
  if (models.length === 0) {
    const none = query.length > 0 || category !== null ? "No matching models." : "No models found.";
    lines.push({ kind: "note", text: none });
  }
  for (const provider of listing.providers) {
    if (provider.status === "needs_key") {
      lines.push({ kind: "note", text: `${provider.provider}: /login ${provider.provider} to list its models` });
    } else if (provider.status === "server_down") {
      lines.push({ kind: "note", text: `${provider.provider}: not answering` });
    } else if (provider.status === "not_installed") {
      lines.push({ kind: "note", text: `${provider.provider}: not installed · Enter on one of its models installs it` });
    }
  }
  // The first line is the category tabs. The list scrolls in the lines below it.
  const room = rows - 1;
  const at = lines.findIndex((line) => line.kind === "model" && line.selected);
  const start = Math.min(Math.max(0, at - room + 2), Math.max(0, lines.length - room));
  return [categoryTabs(category), ...lines.slice(start, start + room)];
}

/** `All` and each category, with the chosen one marked. */
function categoryTabs(category: Category | null): PickerRow {
  const tabs = [{ label: "All", active: category === null }];
  for (const name of CATEGORIES) {
    tabs.push({ label: categoryName(name), active: name === category });
  }
  return { kind: "tabs", tabs };
}

function modelRow(model: ListedModel, selected: boolean, current: boolean, columns: number, missing: boolean): PickerRow {
  const facts = [categoriesLabel(model), contextLabel(model.ctx), priceLabel(model), sizeLabel(model), statusLabel(model, missing)]
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
