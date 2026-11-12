import { STEP_MARKS, stepper, type Mark, type SetupLine, type SetupWindow } from "@golem/view";

import type { Press } from "./keys.ts";

/**
 * The setup window's frame in the terminal: a box about 60 columns wide,
 * centred on an empty screen. Under 60×20 it loses its border and goes full
 * width, with `2/5 Engine` in place of the stepper.
 */
export const SETUP_WIDTH = 60;

export function compactSetup(columns: number, rows: number): boolean {
  return columns < SETUP_WIDTH || rows < 20;
}

/** The columns a line has inside the frame: the border and one column of padding on each side. */
export function setupInner(columns: number, rows: number): number {
  return compactSetup(columns, rows) ? columns : Math.min(SETUP_WIDTH, columns) - 4;
}

export type SetupKey = "up" | "down" | "enter" | "back" | "quit" | "interrupt" | "recheck";

/** The window's keys. Ctrl-C is q, except that a second one on Quit setup? quits golem. */
export function setupKeyOf(press: Press): SetupKey | null {
  switch (press.name) {
    case "up":
      return "up";
    case "down":
      return "down";
    case "return":
      return "enter";
    case "escape":
      return "back";
    case "ctrl-c":
      return "interrupt";
    default:
      break;
  }
  if (press.ctrl || press.meta) {
    return null;
  }
  if (press.input === "q") {
    return "quit";
  }
  return press.input === "r" ? "recheck" : null;
}

/** What the frame shows now, for its key hints. */
export type SetupScreen =
  | "service-ask"
  | "service-wait"
  | "service-failed"
  | "engine"
  | "ollama-ask"
  | "ollama-installing"
  | "ollama-waiting"
  | "model"
  | "model-local"
  | "model-gone"
  | "model-downloading"
  | "provider"
  | "key-typing"
  | "ready"
  | "overview"
  | "quit";

export function setupHint(screen: SetupScreen, window: SetupWindow): string {
  const fromStart = window.view === "panel" && window.origin === "start";
  switch (screen) {
    case "service-ask":
      return fromStart && window.view === "panel" && window.trail.length === 0
        ? "Enter picks · ↑↓ move · q quit"
        : "Enter picks · ↑↓ move · Esc back";
    case "service-wait":
      return "";
    case "service-failed":
    case "quit":
      return "Enter picks · ↑↓ move";
    case "engine":
      return window.view === "panel" && window.origin === "send"
        ? "Enter picks · ↑↓ move · Esc back"
        : "Enter picks · ↑↓ move · Esc back · q quit";
    case "key-typing":
      return "Enter checks · Esc back";
    case "provider":
    case "ollama-ask":
    case "model":
      return "Enter picks · ↑↓ move · Esc back";
    case "ollama-installing":
      return "Esc stops";
    case "ollama-waiting":
      return "Esc back";
    case "model-local":
      return "Enter downloads · ↑↓ move · Esc back";
    case "model-gone":
      return "Enter picks · ↑↓ move · Esc chat without a model";
    case "model-downloading":
      return "Esc keeps it downloading and opens the chat";
    case "ready":
      return "Enter starts chatting";
    case "overview":
      return "Enter picks · ↑↓ move · r recheck · Esc back to chat";
  }
}

/** The hint with only its keys, for a small terminal: `Enter · ↑↓ · Esc`. */
export function shortHint(hint: string): string {
  return hint
    .split(" · ")
    .map((part) => part.split(" ")[0] ?? part)
    .join(" · ");
}

export type Tone = "plain" | "bold" | "dim" | "ok" | "fail" | "attn" | "clay" | "selected";

export type Span = { text: string; tone: Tone };

export const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

const GLYPHS: Record<Exclude<Mark, "spin">, { text: string; tone: Tone }> = {
  ok: { text: "✓", tone: "ok" },
  fail: { text: "✗", tone: "fail" },
  attn: { text: "!", tone: "attn" },
};

function glyph(mark: Mark, frame: number): Span {
  return mark === "spin" ? { text: SPINNER[frame % SPINNER.length] ?? "⠋", tone: "clay" } : GLYPHS[mark];
}

/** How wide an option's label is, so the details line up. */
export function labelWidth(lines: readonly SetupLine[]): number {
  const labels = lines.flatMap((line) => (line.kind === "option" && line.detail.length > 0 ? [line.label.length] : []));
  return labels.length === 0 ? 0 : Math.max(...labels) + 2;
}

/** One line of a panel as coloured runs, `width` columns wide. */
export function lineSpans(line: SetupLine, width: number, frame: number, labels: number): Span[] {
  switch (line.kind) {
    case "blank":
      return [{ text: " ", tone: "plain" }];
    case "title":
      return [{ text: line.text, tone: "bold" }];
    case "text":
      return [{ text: line.text, tone: line.dim === true ? "dim" : "plain" }];
    case "status": {
      const mark = glyph(line.mark, frame);
      const right = line.right ?? "";
      const gap = Math.max(1, width - 2 - line.text.length - right.length);
      const spans: Span[] = [mark, { text: ` ${line.text}`, tone: "plain" }];
      if (right.length > 0) {
        spans.push({ text: `${" ".repeat(gap)}${right}`, tone: "dim" });
      }
      return spans;
    }
    case "option":
      return [
        { text: line.selected ? "› " : "  ", tone: "clay" },
        { text: line.detail.length > 0 ? line.label.padEnd(labels) : line.label, tone: line.selected ? "selected" : "plain" },
        ...(line.detail.length > 0 ? [{ text: line.detail, tone: "dim" as const }] : []),
      ];
    case "row":
      return [glyph(line.mark, frame), { text: ` ${line.label.padEnd(10)}`, tone: "bold" }, { text: line.text, tone: "plain" }];
    case "field":
      return [
        { text: "❯ ", tone: "clay" },
        { text: line.text, tone: "dim" },
        { text: "▏", tone: frame % 10 < 5 ? "clay" : "plain" },
      ];
  }
}

/** The stepper as runs: `✓ Service ── ● Engine ── ○ Model ── ○ Ready`. */
export function stepperSpans(window: SetupWindow): Span[] | null {
  const steps = stepper(window);
  if (steps === null) {
    return null;
  }
  return steps.flatMap((step, index): Span[] => {
    const tone: Tone = step.state === "done" ? "ok" : step.state === "now" ? "clay" : "dim";
    const join: Span[] = index === 0 ? [] : [{ text: " ── ", tone: "dim" }];
    return [...join, { text: `${STEP_MARKS[step.state]} ${step.name}`, tone }];
  });
}
