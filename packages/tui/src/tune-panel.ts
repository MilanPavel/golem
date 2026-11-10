import {
  applyPreset,
  defaultNote,
  focusedRow,
  formatTuneValue,
  keepSession,
  memoryNote,
  moveFocus,
  presetForKey,
  PRESETS_HINT,
  reset,
  sliderCells,
  step,
  toggleTarget,
  tuneRows,
  written,
  type MemoryFit,
  type TuneState,
  type TuneTarget,
  type TuneValue,
} from "@golem/view";

import type { Press } from "./keys.ts";

/**
 * `/tune`: one row per option with a block slider, and the explanation of the focused one under
 * the rows. The state and its changes are the view package's; this is the keys and the lines.
 */
export type TuneKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "reset"
  | "target"
  | "try"
  | "close"
  | "preset-1"
  | "preset-2"
  | "preset-3"
  | "preset-4"
  | "save";

/** What a key asks the app to do after the state changed. */
export type TuneAction =
  | { kind: "none" }
  | { kind: "close" }
  /** Ask the last question again with these values, in a fork. */
  | { kind: "try" }
  /** Send `value` for `name`: `null` removes it. It goes to the model's saved options or to the session. */
  | { kind: "change"; name: string; value: TuneValue | null; target: TuneTarget }
  /** Send a preset's values to this session: `null` removes an override. */
  | { kind: "preset"; options: Record<string, number | null> }
  /** Save `save` for the model, then clear the same names from the session with `clear`. */
  | { kind: "save"; save: Record<string, TuneValue>; clear: Record<string, null> };

export type TuneOpening =
  | { kind: "open"; model: string; sessionId: string }
  | { kind: "notice"; text: string };

export const NEEDS_SESSION_NOTICE = "open a session first";
export const NO_MODEL_NOTICE = "Choose a model first: /model.";

const SLIDER_CELLS = 15;
const KEYS = "↑/↓ move · ←/→ change · r reset · t try again · Esc close";

/** Whether `/tune` can open: a session on a local Ollama model. Else the notice to show. */
export function tuneOpening(input: {
  connected: boolean;
  sessionId: string | null;
  provider: string | null;
  name: string | null;
}): TuneOpening {
  if (!input.connected || input.sessionId === null) {
    return { kind: "notice", text: NEEDS_SESSION_NOTICE };
  }
  if (input.provider === null || input.name === null) {
    return { kind: "notice", text: NO_MODEL_NOTICE };
  }
  if (input.provider !== "ollama") {
    return { kind: "notice", text: `Tuning is for local Ollama models. ${input.name} is hosted.` };
  }
  return { kind: "open", model: input.name, sessionId: input.sessionId };
}

/** Map a key press to a tune key. Other keys do nothing while the panel is open. */
export function tuneKeyOf(press: Press): TuneKey | null {
  switch (press.name) {
    case "up":
      return "up";
    case "down":
      return "down";
    case "left":
      return "left";
    case "right":
      return "right";
    case "escape":
    case "ctrl-c":
      return "close";
    default:
      break;
  }
  if (press.ctrl || press.meta) {
    return null;
  }
  if (press.input === "r") {
    return "reset";
  }
  if (press.input === "s") {
    return "target";
  }
  if (press.input === "t") {
    return "try";
  }
  if (press.input === "S") {
    return "save";
  }
  if (press.input === "1" || press.input === "2" || press.input === "3" || press.input === "4") {
    return `preset-${press.input}`;
  }
  return null;
}

export function pressTune(state: TuneState, key: TuneKey): { state: TuneState; action: TuneAction } {
  const none: TuneAction = { kind: "none" };
  if (key.startsWith("preset-")) {
    const preset = presetForKey(Number(key.slice(7)));
    if (preset === null) {
      return { state, action: none };
    }
    const applied = applyPreset(state, preset);
    return { state: applied.state, action: { kind: "preset", options: applied.options } };
  }
  state = settle(state, key);
  switch (key) {
    case "save": {
      const kept = keepSession(state);
      if (Object.keys(kept.save).length === 0) {
        return { state, action: none };
      }
      return { state: kept.state, action: { kind: "save", save: kept.save, clear: kept.clear } };
    }
    case "preset-1":
    case "preset-2":
    case "preset-3":
    case "preset-4":
      return { state, action: none };
    case "close":
      return { state, action: { kind: "close" } };
    case "up":
      return { state: moveFocus(state, -1), action: none };
    case "down":
      return { state: moveFocus(state, 1), action: none };
    case "try":
      return { state, action: { kind: "try" } };
    case "target":
      return { state: toggleTarget(state), action: none };
    case "left":
    case "right": {
      const name = focusedRow(state)?.option.name;
      if (name === undefined) {
        return { state, action: none };
      }
      const next = step(state, name, key === "right" ? 1 : -1);
      return { state: next, action: change(next, name) };
    }
    case "reset": {
      const name = focusedRow(state)?.option.name;
      if (name === undefined) {
        return { state, action: none };
      }
      const next = reset(state, name);
      return { state: next, action: change(next, name) };
    }
  }
}

/** A key press ends the lit rows. A change by hand ends the preset's name. */
function settle(state: TuneState, key: TuneKey): TuneState {
  if (state.lit === undefined && state.preset === undefined) {
    return state;
  }
  const next: TuneState = { ...state };
  delete next.lit;
  if (key === "left" || key === "right" || key === "reset" || key === "target") {
    delete next.preset;
  }
  return next;
}

/** The lines of {@link tuneLines} that show a row the last preset moved, to draw in the accent colour. */
export function tuneLitLines(state: TuneState): number[] {
  const lit = state.lit ?? [];
  return state.options.flatMap((option, index) => (lit.includes(option.name) ? [index + 1] : []));
}

/**
 * Where the memory gauge sits in {@link tuneLines}: the line, the column it starts at, and the
 * verdict, so the screen can colour it. Empty when the gauge is not shown.
 */
export function tuneMemorySpans(
  state: TuneState,
  columns: number,
): { line: number; start: number; fit: MemoryFit }[] {
  const lines = tuneLines(state, columns);
  return tuneRows(state).flatMap((row, index) => {
    const note = memoryNote(state, row);
    const start = note === null ? -1 : (lines[index + 1] ?? "").indexOf(note.text);
    return note !== null && start >= 0 ? [{ line: index + 1, start, fit: note.fit }] : [];
  });
}

function change(state: TuneState, name: string): TuneAction {
  return { kind: "change", name, value: written(state, name), target: state.target };
}

/** The panel as lines, each cut to `columns`. */
export function tuneLines(state: TuneState, columns: number): string[] {
  const width = Math.max(1, columns);
  const rows = tuneRows(state);
  const nameWidth = rows.reduce((max, row) => Math.max(max, row.option.name.length), 0);
  const cells = Math.max(4, Math.min(SLIDER_CELLS, width - nameWidth - 42));
  const valueWidth = Math.max(0, ...rows.map((row) => formatTuneValue(row.option, row.value).length));
  const lines = [header(state, width)];
  rows.forEach((row, index) => {
    const pointer = index === state.focus ? "▸" : " ";
    const slider = row.option.kind === "duration" ? " ".repeat(cells + 2) : sliderCells(row.value, row.option, cells);
    const value = formatTuneValue(row.option, row.value).padEnd(valueWidth);
    const notes: string[] = [];
    const memory = memoryNote(state, row);
    if (memory !== null) {
      notes.push(memory.text);
    }
    const fallbackNote = defaultNote(state, row);
    if (fallbackNote !== null) {
      notes.push(fallbackNote);
    }
    if (row.source === "session") {
      notes.push("this session");
    }
    lines.push(` ${pointer} ${row.option.name.padEnd(nameWidth)}  ${slider} ${value}  ${notes.join(" · ")}`.trimEnd());
  });
  const focused = focusedRow(state);
  if (focused !== null) {
    const title = `─ ${focused.option.name} `;
    lines.push(title + "─".repeat(Math.max(0, width - title.length)));
    const warning = memoryNote(state, focused)?.warning;
    const text = warning === undefined ? focused.option.long : `${focused.option.long} ${warning}`;
    lines.push(...wrap(text, Math.max(1, width - 1)).map((line) => ` ${line}`));
  }
  lines.push(` ${KEYS}`);
  lines.push(` ${PRESETS_HINT}`);
  if (Object.keys(state.session).length > 0) {
    lines.push(" S save this session's values for the model");
  }
  return lines.map((line) => fit(line, width));
}

function header(state: TuneState, width: number): string {
  const left = ` tune · ${state.model}`;
  const right =
    state.preset !== undefined
      ? `preset ${state.preset} · this session`
      : state.target === "saved"
      ? "saved for this model · s this session only"
      : "this session only · s saved for this model";
  const gap = width - left.length - right.length;
  return gap >= 2 ? `${left}${" ".repeat(gap)}${right}` : `${left}  ${right}`;
}

/** Cut `text` into lines of at most `width` characters, at spaces. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((item) => item.length > 0)) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line.length === 0 ? word : `${line} ${word}`;
    }
  }
  if (line.length > 0) {
    lines.push(line);
  }
  return lines;
}

function fit(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }
  return width === 1 ? "…" : `${text.slice(0, width - 1)}…`;
}
