import type { ModelMemory, ModelOption, ModelOptionsGetResult } from "@golem/client";

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
  /** Where a default that is not Ollama's fixed one came from: the Modelfile, or Ollama's own load. */
  defaultFrom: Readonly<Record<string, "modelfile" | "ollama">>;
  saved: Readonly<Record<string, TuneValue>>;
  session: Readonly<Record<string, TuneValue>>;
  /** What the daemon knows of this machine's memory and the model's size, or null when it does not. */
  memory: ModelMemory | null;
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

/** True for an option that steps through a list: a duration, or a choice among `values`. */
export function isListKind(option: ModelOption): boolean {
  return option.kind === "duration" || option.kind === "choice";
}

/** The range of a number option. A choice has none, so these are 0, 0, and 1 for it. */
export function rangeOf(option: ModelOption): { minimum: number; maximum: number; step: number } {
  return { minimum: option.minimum ?? 0, maximum: option.maximum ?? 0, step: option.step ?? 1 };
}

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

/** The most `long memory` asks for. */
export const LONG_MEMORY_MAX_CTX = 32768;
/** What `long memory` sets when the machine's memory or the model's size is not known. */
const LONG_MEMORY_FALLBACK = 16384;

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
  { key: 4, id: "long-memory", label: "long memory", options: { num_ctx: LONG_MEMORY_FALLBACK } },
];

/** The hint line under the explanation. */
export const PRESETS_HINT = `presets  ${PRESETS.map((preset) => `${preset.key} ${preset.label}`).join("   ")}`;

const FILLS = "▏▎▍▌▋▊▉";

export function tuneState(result: ModelOptionsGetResult): TuneState {
  return {
    model: result.model,
    options: result.options,
    defaults: result.defaults,
    defaultFrom: result.default_from ?? {},
    saved: result.saved,
    session: result.session ?? {},
    memory: result.memory ?? null,
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

/** What `num_ctx` starts at on the first step or drag when it has no default and no value. */
export const NUM_CTX_START = 8192;

/** What a row says about its default, or null. `num_ctx` with no default says Ollama sets it when it loads. */
export function defaultNote(state: TuneState, row: TuneRow): string | null {
  const name = row.option.name;
  if (row.option.kind === "choice") return "model default · thinks";
  const fallback = state.defaults[name];
  if (fallback === undefined) {
    return name === "num_ctx" && row.value === null ? "set by Ollama when it loads" : null;
  }
  const origin = state.defaultFrom[name];
  if (origin !== undefined) {
    return `model default ${formatTuneValue(row.option, fallback)} · from ${origin === "ollama" ? "Ollama" : "the Modelfile"}`;
  }
  return differsFromDefault(state, row) ? `model default ${formatTuneValue(row.option, fallback)}` : null;
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
  if (name === "num_ctx" && current === null && !isListKind(option)) {
    const { minimum, maximum } = rangeOf(option);
    return put(state, name, Math.min(maximum, Math.max(minimum, NUM_CTX_START)));
  }
  const next =
    option.kind === "choice"
      ? nextChoice(option.values ?? [], current, direction)
      : option.kind === "duration"
      ? nextDuration(current, direction)
      : nextNumber(option, current, direction);
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
 * What a preset sets for this model. `long memory` takes the largest `num_ctx` step that fits in
 * memory, at most {@link LONG_MEMORY_MAX_CTX}; with no memory known, or none that fits, a fixed value.
 */
export function presetOptions(state: TuneState, preset: TunePreset): Record<string, number | null> {
  if (preset.id !== "long-memory") return { ...preset.options };
  const option = state.options.find((item) => item.name === "num_ctx");
  if (option === undefined || state.memory === null) return { ...preset.options };
  return { num_ctx: largestFittingCtx(option, state.memory) ?? LONG_MEMORY_FALLBACK };
}

/** The largest value of `option`'s steps, up to {@link LONG_MEMORY_MAX_CTX}, that fits. Null when none does. */
export function largestFittingCtx(option: ModelOption, memory: ModelMemory): number | null {
  const range = rangeOf(option);
  const top = Math.min(range.maximum, LONG_MEMORY_MAX_CTX);
  const steps = Math.floor((top - range.minimum) / range.step);
  for (let at = steps; at >= 0; at -= 1) {
    const ctx = range.minimum + at * range.step;
    if (memoryFor(ctx, memory, ctx).fit === "fits") return ctx;
  }
  return null;
}

/**
 * Apply a preset to this session, whatever the target says. `options` is what to send with
 * `session.set_options`; `state` has the new overrides, the preset's name, and the rows that moved.
 */
export function applyPreset(
  state: TuneState,
  preset: TunePreset,
): { state: TuneState; options: Record<string, number | null> } {
  const values = presetOptions(state, preset);
  const session: Record<string, TuneValue> = { ...state.session };
  for (const [name, value] of Object.entries(values)) {
    if (value === null) {
      delete session[name];
    } else {
      session[name] = value;
    }
  }
  const moved = { ...state, session };
  const next: TuneState = { ...moved, preset: preset.label, lit: changedRows(state, moved) };
  return { state: next, options: { ...values } };
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

/** Whether a model with a window of `ctx` tokens loads in this machine's memory. Same rule as the daemon's `fit`. */
export type MemoryFit = "fits" | "tight" | "too_big";

/** The KV-cache memory for `ctx` tokens, in GB. The daemon's `kv_gb`. */
export function kvGb(ctx: number, memory: ModelMemory): number {
  return (ctx / 1024) * memory.kv_gb_per_1k_tokens;
}

/**
 * What `ctx` costs against `baseCtx`, the default window: `extraGb` is the KV cache for `ctx`
 * minus the KV cache for `baseCtx`, negative below the default. With no default (`baseCtx` null)
 * it is the KV cache for `ctx` alone. `fit` is for the whole model with
 * `ctx`, the rule of the daemon's `hardware.fit`: `fits` within `fits_share` of RAM, `tight`
 * within `tight_share`, else `too_big`.
 */
export function memoryFor(ctx: number, memory: ModelMemory, baseCtx: number | null): { extraGb: number; fit: MemoryFit } {
  const need = memory.size_gb + kvGb(ctx, memory) + memory.overhead_gb;
  const fit: MemoryFit =
    need <= memory.ram_gb * memory.fits_share
      ? "fits"
      : need <= memory.ram_gb * memory.tight_share
      ? "tight"
      : "too_big";
  return { extraGb: kvGb(ctx, memory) - (baseCtx === null ? 0 : kvGb(baseCtx, memory)), fit };
}

/** A memory change as the panel shows it: `+1.1 GB`, or `−0.5 GB` below the default. */
export function formatExtraGb(extraGb: number): string {
  const rounded = Number(Math.abs(extraGb).toFixed(1));
  return `${extraGb < 0 && rounded > 0 ? "−" : "+"}${rounded.toFixed(1)} GB`;
}

/** The note after the `num_ctx` value: `+1.1 GB · fits`, or `2.1 GB for the window · fits` with no default, and `warning` when it is too big. */
export type MemoryNote = { text: string; fit: MemoryFit; warning?: string };

/** The memory gauge for a row, or null for any option but `num_ctx`, or when the memory is not known. */
export function memoryNote(state: TuneState, row: TuneRow): MemoryNote | null {
  if (row.option.name !== "num_ctx" || state.memory === null || typeof row.value !== "number") return null;
  const fallback = state.defaults["num_ctx"];
  const base = typeof fallback === "number" ? fallback : null;
  const { extraGb, fit } = memoryFor(row.value, state.memory, base);
  const verdict = fit === "fits" ? "fits" : fit === "tight" ? "tight" : "too big";
  const amount = base === null ? `${Number(extraGb.toFixed(1)).toFixed(1)} GB for the window` : formatExtraGb(extraGb);
  const note: MemoryNote = { text: `${amount} · ${verdict}`, fit };
  if (fit === "too_big") note.warning = "This may not load on this Mac.";
  return note;
}

/**
 * The block slider: `▕`, a `█` for each full cell, one partial block, spaces, and `▏`. `width` is
 * the cells between the two ends. A missing value draws as the minimum.
 */
export function sliderCells(value: TuneValue | null, option: ModelOption, width: number): string {
  const cells = Math.max(0, Math.floor(width));
  const { minimum, maximum } = rangeOf(option);
  const span = maximum - minimum;
  const number = typeof value === "number" ? value : minimum;
  const share = span > 0 ? Math.min(1, Math.max(0, (number - minimum) / span)) : 0;
  const eighths = Math.round(share * cells * 8);
  const full = Math.floor(eighths / 8);
  const part = eighths % 8 === 0 ? "" : (FILLS[(eighths % 8) - 1] ?? "");
  const spaces = cells - full - part.length;
  return `▕${"█".repeat(full)}${part}${" ".repeat(Math.max(0, spaces))}▏`;
}

/** A value as the panel shows it: `0.7`, `16K` for a window, `5m`, `always`, or `random` with no seed. */
export function formatTuneValue(option: ModelOption, value: TuneValue | null): string {
  if (value === null) return option.name === "seed" ? "random" : option.kind === "choice" ? "unset" : "none";
  if (option.kind === "duration") return String(value) === "-1" ? "always" : String(value);
  if (typeof value === "string") return value;
  if (option.name === "num_ctx") return `${trim(value / 1024, 1)}K`;
  return trim(value, Math.max(2, decimals(rangeOf(option).step)));
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
  const { minimum, maximum, step } = rangeOf(option);
  const base = typeof current === "number" ? current : Number(current ?? minimum);
  const start = Number.isFinite(base) ? base : minimum;
  const moved = start + direction * step;
  const rounded = Number(moved.toFixed(decimals(step)));
  return Math.min(maximum, Math.max(minimum, rounded));
}

/** The next value in `values`, clamped at the ends. With no value yet, the first step goes to the first or last. */
function nextChoice(values: readonly string[], current: TuneValue | null, direction: 1 | -1): TuneValue | null {
  if (values.length === 0) return null;
  const at = values.indexOf(String(current));
  if (current === null || at < 0) return (direction === 1 ? values[0] : values[values.length - 1]) ?? null;
  return values[Math.min(values.length - 1, Math.max(0, at + direction))] ?? null;
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

/** The most options the status chip names before `+N`. */
export const TUNE_CHIP_MAX = 3;

/**
 * The status line's tune chip: `temp 0.2 · top_p 0.9`, the options whose value in use differs from
 * the model's default, in table order. `num_ctx` is left out, because the context meter shows the
 * window. At most {@link TUNE_CHIP_MAX} are named, then `+N`. Empty when nothing differs, when the
 * options are not known, and on a hosted model, which ignores them.
 */
export function tuneChip(state: TuneState | null, provider: string | null): string {
  if (state === null || (provider !== null && provider !== "ollama")) return "";
  const parts = tuneRows(state)
    .filter((row) => row.option.name !== "num_ctx" && differsFromDefault(state, row))
    .map((row) => `${row.option.name === "temperature" ? "temp" : row.option.name} ${formatTuneValue(row.option, row.value)}`);
  if (parts.length <= TUNE_CHIP_MAX) return parts.join(" · ");
  return `${parts.slice(0, TUNE_CHIP_MAX).join(" · ")} +${parts.length - TUNE_CHIP_MAX}`;
}

/** What `/tune <option> <value>` asks for: a value, or null to remove the session's override. */
export type TuneSetResult =
  | { kind: "set"; name: string; value: TuneValue | null; notice: string }
  | { kind: "error"; notice: string };

export const TUNE_USAGE = "/tune, /tune <option> <value>, or /tune <option> reset";

/** Check one typed value against the table. The messages are the daemon's own. */
export function parseTuneValue(option: ModelOption, text: string): { value: TuneValue } | { error: string } {
  const { name } = option;
  if (option.kind === "choice") {
    const values = option.values ?? [];
    if (!values.includes(text)) return { error: `${name} is one of ${values.join(", ")}` };
    return { value: text };
  }
  if (option.kind === "duration") {
    if (!/^-?\d+(\.\d+)?(ms|s|m|h)?$/.test(text)) return { error: `${name} is a time such as 5m, or -1` };
    return { value: /^-?\d+$/.test(text) ? Number(text) : text };
  }
  const number = Number(text);
  if (text.length === 0 || !Number.isFinite(number)) return { error: `${name} is a number` };
  if (option.kind === "int" && !Number.isInteger(number)) return { error: `${name} is a whole number` };
  const { minimum, maximum } = rangeOf(option);
  if (number < minimum || number > maximum) {
    return { error: `${name} is between ${trim(minimum, 6)} and ${trim(maximum, 6)}` };
  }
  return { value: number };
}

/**
 * `/tune <option> <value>` and `/tune <option> reset`, for this session only. `args` are the words
 * after `/tune`, and `options` the table.
 */
export function tuneSet(options: readonly ModelOption[], args: readonly string[]): TuneSetResult {
  const [name, text, ...extra] = args;
  if (name === undefined || text === undefined || extra.length > 0) return { kind: "error", notice: TUNE_USAGE };
  if (options.length === 0) {
    return { kind: "error", notice: "Tuning is for local Ollama models, in a session with one." };
  }
  const option = options.find((item) => item.name === name);
  if (option === undefined) {
    return { kind: "error", notice: `${name} is not an option to tune: ${options.map((item) => item.name).join(", ")}` };
  }
  if (text === "reset") {
    return { kind: "set", name, value: null, notice: `${name} reset for this session` };
  }
  const parsed = parseTuneValue(option, text);
  if ("error" in parsed) return { kind: "error", notice: parsed.error };
  return { kind: "set", name, value: parsed.value, notice: `${name} ${String(parsed.value)} for this session` };
}

/**
 * The hint after an option's name: its default and range, `0.7 · 0–2`. `defaults` are the model's
 * own values when known, else the table's.
 */
export function tuneHint(option: ModelOption, defaults: Readonly<Record<string, TuneValue>> = {}): string {
  const fallback = defaults[option.name] ?? option.default;
  if (option.kind === "choice") return `model default · ${(option.values ?? []).join(", ")}`;
  const shown =
    fallback == null && option.name === "num_ctx" ? "set by Ollama" : formatTuneValue(option, fallback ?? null);
  const { minimum, maximum } = rangeOf(option);
  const range = option.kind === "duration" ? "a time such as 5m, or -1" : `${trim(minimum, 6)}–${trim(maximum, 6)}`;
  return `${shown} · ${range}`;
}

/** The hints for every option, by name. */
export function tuneHints(
  options: readonly ModelOption[],
  defaults: Readonly<Record<string, TuneValue>> = {},
): Record<string, string> {
  return Object.fromEntries(options.map((option) => [option.name, tuneHint(option, defaults)]));
}
