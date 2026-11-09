import type { ModelOption, ModelOptionsGetResult } from "@golem/client";

/**
 * `/tune`: the options of a local model, the value in use for each, and where it comes from.
 * Pure: the screens draw it, and send what `written` says after a change.
 */

export type TuneValue = number | string;
/** Where a value in use comes from: this session's override, what is saved for the model, or the default. */
export type TuneSource = "session" | "saved" | "default";
/** Where a change goes: into `config.toml` for the model, or into this session only. */
export type TuneTarget = "saved" | "session";

export type TuneState = {
  /** The model's name as the daemon says it, without `ollama/`. */
  model: string;
  /** The table, in order. */
  options: readonly ModelOption[];
  /** The model's own values, else Ollama's. */
  defaults: Readonly<Record<string, TuneValue>>;
  saved: Readonly<Record<string, TuneValue>>;
  session: Readonly<Record<string, TuneValue>>;
  /** Index of the focused option. */
  focus: number;
  target: TuneTarget;
  /** The id of the preset just applied to this session, until a value changes by hand. */
  preset?: string;
  /** Names of the rows the last preset moved, until the next key press. */
  lit?: readonly string[];
};

/** One option with the value in use. `value` is null when there is none, such as a random seed. */
export type TuneRow = { option: ModelOption; value: TuneValue | null; source: TuneSource };

/** What `keep_alive` steps through, from unloading at once to never. */
export const KEEP_ALIVE_STEPS: readonly TuneValue[] = [0, "30s", "5m", "30m", -1];

/** A preset: a few values for this session. `null` removes an override, back to the model's own value. */
export type TunePreset = {
  /** The key that applies it. */
  key: 1 | 2 | 3 | 4;
  id: string;
  label: string;
  options: Readonly<Record<string, number | null>>;
};

/** The sampling options that `balanced` clears. */
const SAMPLING = ["temperature", "top_p", "top_k", "min_p", "repeat_penalty"] as const;

/** The presets, in key order. Every value is inside the option table's range. */
export const PRESETS: readonly TunePreset[] = [
  { key: 1, id: "precise", label: "precise", options: { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 } },
  {
    key: 2,
    id: "balanced",
    label: "balanced",
    options: Object.fromEntries(SAMPLING.map((name) => [name, null])),
  },
  { key: 3, id: "creative", label: "creative", options: { temperature: 1.0, top_p: 0.95, min_p: 0.05 } },
  { key: 4, id: "long-memory", label: "long memory", options: { num_ctx: 16384 } },
];

/** The hint line under the explanation. */
export const PRESETS_HINT = `presets  ${PRESETS.map((preset) => `${preset.key} ${preset.label}`).join("   ")}`;

const FILLS = "▏▎▍▌▋▊▉";

export function tuneState(result: ModelOptionsGetResult): TuneState {
  return {
    model: result.model,
    options: result.options,
    defaults: result.defaults,
    saved: result.saved,
    session: result.session ?? {},
    focus: 0,
    target: "saved",
  };
}

/** The value in use: the session's, else the saved, else the default. */
export function tuneRow(state: TuneState, option: ModelOption): TuneRow {
  const { name } = option;
  const session = state.session[name];
  if (session !== undefined) return { option, value: session, source: "session" };
  const saved = state.saved[name];
  if (saved !== undefined) return { option, value: saved, source: "saved" };
  const fallback = state.defaults[name];
  return { option, value: fallback === undefined ? null : fallback, source: "default" };
}

export function tuneRows(state: TuneState): TuneRow[] {
  return state.options.map((option) => tuneRow(state, option));
}

/** The focused row, or null for an empty table. */
export function focusedRow(state: TuneState): TuneRow | null {
  const option = state.options[state.focus];
  return option === undefined ? null : tuneRow(state, option);
}

/** True when the value in use is not the default, so the row says `model default X`. */
export function differsFromDefault(state: TuneState, row: TuneRow): boolean {
  const fallback = state.defaults[row.option.name];
  if (row.value === null || fallback === undefined) return row.value !== null;
  return String(row.value) !== String(fallback);
}

export function moveFocus(state: TuneState, by: number): TuneState {
  if (state.options.length === 0) return state;
  const focus = Math.min(state.options.length - 1, Math.max(0, state.focus + by));
  return focus === state.focus ? state : { ...state, focus };
}

export function toggleTarget(state: TuneState): TuneState {
  return { ...state, target: state.target === "saved" ? "session" : "saved" };
}

/**
 * One notch more or less: `step` of the option for a number, clamped to its range and rounded to
 * the step's decimals, or the next time in {@link KEEP_ALIVE_STEPS} for a duration. The new value
 * goes into `state.target`. With no value yet, as for a seed, it starts at the minimum.
 */
export function step(state: TuneState, name: string, direction: 1 | -1): TuneState {
  const option = state.options.find((item) => item.name === name);
  if (option === undefined) return state;
  const current = tuneRow(state, option).value;
  const next = option.kind === "duration" ? nextDuration(current, direction) : nextNumber(option, current, direction);
  return put(state, name, next);
}

/** Back to the default: removes the value in `state.target`. */
export function reset(state: TuneState, name: string): TuneState {
  return put(state, name, null);
}

/** What the last change put into `state.target` for `name`: the value, or null once removed. */
export function written(state: TuneState, name: string): TuneValue | null {
  return state[state.target][name] ?? null;
}

/** The session's overrides, as `model.options.changed` says them. */
export function withSession(state: TuneState, options: Readonly<Record<string, TuneValue>>): TuneState {
  return { ...state, session: options };
}

/** What is saved for the model, as `model.options.saved` says it. Another model's is ignored. */
export function withSaved(state: TuneState, model: string, saved: Readonly<Record<string, TuneValue>>): TuneState {
  return model === state.model ? { ...state, saved } : state;
}

/** The preset for a key, or null. */
export function presetForKey(key: number): TunePreset | null {
  return PRESETS.find((preset) => preset.key === key) ?? null;
}

/** Names of the rows whose value in use differs between two states, in table order. */
export function changedRows(before: TuneState, after: TuneState): string[] {
  return after.options
    .filter((option) => tuneRow(before, option).value !== tuneRow(after, option).value)
    .map((option) => option.name);
}

/**
 * Apply a preset to this session, whatever the target says. `options` is what to send with
 * `session.set_options`; `state` has the new overrides, the preset's name, and the rows that moved.
 */
export function applyPreset(
  state: TuneState,
  preset: TunePreset,
): { state: TuneState; options: Record<string, number | null> } {
  const session: Record<string, TuneValue> = { ...state.session };
  for (const [name, value] of Object.entries(preset.options)) {
    if (value === null) {
      delete session[name];
    } else {
      session[name] = value;
    }
  }
  const moved = { ...state, session };
  const next: TuneState = { ...moved, preset: preset.label, lit: changedRows(state, moved) };
  return { state: next, options: { ...preset.options } };
}

/**
 * Keep the session's overrides for the model: `saved` takes them, the session is left empty.
 * `save` is what to send to `model.options.set`, `clear` the nulls for `session.set_options`.
 */
export function keepSession(state: TuneState): {
  state: TuneState;
  save: Record<string, TuneValue>;
  clear: Record<string, null>;
} {
  const save = { ...state.session };
  const clear = Object.fromEntries(Object.keys(save).map((name) => [name, null]));
  const next: TuneState = { ...state, saved: { ...state.saved, ...save }, session: {} };
  delete next.preset;
  delete next.lit;
  return { state: next, save, clear };
}

/**
 * The block slider: `▕`, a `█` for each full cell, one partial block, spaces, and `▏`. `width` is
 * the cells between the two ends. A missing value draws as the minimum.
 */
export function sliderCells(value: TuneValue | null, option: ModelOption, width: number): string {
  const cells = Math.max(0, Math.floor(width));
  const span = option.maximum - option.minimum;
  const number = typeof value === "number" ? value : option.minimum;
  const share = span > 0 ? Math.min(1, Math.max(0, (number - option.minimum) / span)) : 0;
  const eighths = Math.round(share * cells * 8);
  const full = Math.floor(eighths / 8);
  const part = eighths % 8 === 0 ? "" : (FILLS[(eighths % 8) - 1] ?? "");
  const spaces = cells - full - part.length;
  return `▕${"█".repeat(full)}${part}${" ".repeat(Math.max(0, spaces))}▏`;
}

/** A value as the panel shows it: `0.7`, `16K` for a window, `5m`, `always`, or `random` with no seed. */
export function formatTuneValue(option: ModelOption, value: TuneValue | null): string {
  if (value === null) return option.name === "seed" ? "random" : "none";
  if (option.kind === "duration") return String(value) === "-1" ? "always" : String(value);
  if (typeof value === "string") return value;
  if (option.name === "num_ctx") return `${trim(value / 1024, 1)}K`;
  return trim(value, Math.max(2, decimals(option.step)));
}

function put(state: TuneState, name: string, value: TuneValue | null): TuneState {
  const layer = { ...state[state.target] };
  if (value === null) {
    delete layer[name];
  } else {
    layer[name] = value;
  }
  return state.target === "saved" ? { ...state, saved: layer } : { ...state, session: layer };
}

function nextNumber(option: ModelOption, current: TuneValue | null, direction: 1 | -1): number {
  const base = typeof current === "number" ? current : Number(current ?? option.minimum);
  const start = Number.isFinite(base) ? base : option.minimum;
  const moved = start + direction * option.step;
  const rounded = Number(moved.toFixed(decimals(option.step)));
  return Math.min(option.maximum, Math.max(option.minimum, rounded));
}

function nextDuration(current: TuneValue | null, direction: 1 | -1): TuneValue {
  const first = KEEP_ALIVE_STEPS[0] as TuneValue;
  const last = KEEP_ALIVE_STEPS[KEEP_ALIVE_STEPS.length - 1] as TuneValue;
  if (current === null) return KEEP_ALIVE_STEPS[2] ?? first;
  const seconds = durationSeconds(current);
  const ranked = KEEP_ALIVE_STEPS.map((value) => ({ value, seconds: durationSeconds(value) }));
  if (direction === 1) {
    return ranked.find((item) => item.seconds > seconds)?.value ?? last;
  }
  return [...ranked].reverse().find((item) => item.seconds < seconds)?.value ?? first;
}

/** Seconds in a keep-alive value such as `5m`, `30s`, `0`, or `-1`, which is forever. Unknown text is 0. */
function durationSeconds(value: TuneValue): number {
  const match = /^(-?\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(value));
  if (match === null) return 0;
  const amount = Number(match[1]);
  if (amount < 0) return Number.POSITIVE_INFINITY;
  const unit = match[2] ?? "s";
  return amount * (unit === "ms" ? 0.001 : unit === "m" ? 60 : unit === "h" ? 3600 : 1);
}

function decimals(step: number): number {
  return (String(step).split(".")[1] ?? "").length;
}

function trim(value: number, places: number): string {
  return String(Number(value.toFixed(places)));
}
