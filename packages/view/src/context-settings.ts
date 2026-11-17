import { toPercent, windowSize, type ContextSettings, type RouteMode } from "./routing.ts";
import { providerName } from "./setup-window.ts";

/** The words of Settings › Context. */
export const CONTEXT_WORDS = {
  lead: "How much a model can see at once, and how golem keeps a long chat inside it.",
  rightNow: "Right now",
  window: {
    title: "Window size",
    scope: "Local models only",
    line: "How many tokens a model on this Mac can see at once. A hosted model's window is set by its provider.",
    choices: { auto: "Auto", fixed: "Fixed", ollama: "Ollama's" },
    captions: {
      fixed: "The same size for every local model, from 512 to 262144 tokens.",
      ollama: "golem sends no window, so Ollama picks its own.",
    },
    fixedWarning:
      "One size for every local model, and golem does not check it against memory. A large window on a big model can run out of RAM or slow down a lot.",
    chipWins: "A model's own setting in its model chip wins over this choice.",
  },
  fill: {
    title: "When the window fills up",
    scope: "All models",
    line: "Two steps, cheapest first. Move a step to change where it starts.",
    showOn: "Show it on",
    same: "The same settings apply to every model; they are shares of each model's window.",
    zones: { work: "room to work", clear: "1 · clear", summarise: "2 · summarise", reply: "reply" },
  },
  reply: "Room kept for the reply",
  clear: "Clear old tool results",
  clearLine:
    "A tool result is what a tool gave back: a file golem read, the output of a command. Old ones shrink to one line, like read_file src/app.py · 412 lines · cleared. The model can read the file again.",
  keepResults: "Newest results left whole",
  summarise: "Summarise earlier turns",
  summariseLine:
    "Only when clearing was not enough. A turn is one message of yours and everything golem did to answer it. Older turns are replaced by one short summary.",
  keepTurns: "Newest turns kept word for word",
  nothingDeleted: "Nothing is deleted.",
  nothingDeletedMore: " The whole chat stays in the transcript. Only what the model is sent gets shorter.",
  noWindow: "The chart shows once the window size is known.",
  summariseAt: "Summarise at",
  playsOut: "How a long chat plays out",
  playsOutLine: "the chart, with these settings",
  exact: "Exact numbers",
  exactLine: "clear to, typed percentages, keep loaded",
  keepAliveHint:
    "Local models only. How long Ollama keeps the model in memory after a call, such as 30m. Empty sends none.",
  handoff: {
    title: "Context window and long chats",
    line: "The window of local models, and how golem clears old tool results and summarises earlier turns on any model.",
    open: "Settings › Context",
  },
} as const;

export type WindowZoneKind = "work" | "clear" | "summarise" | "reply";
export type WindowZone = { kind: WindowZoneKind; from: number; to: number };
export type WindowBar = {
  room: number;
  zones: WindowZone[];
  /** Where the two settings sit, in percent of the window. */
  marks: { clear: { at: number; label: string }; summarise: { at: number; label: string } };
};

/**
 * The window as one bar. The settings are shares of the room (the window less the reply reserve);
 * the zones and marks are in percent of the whole window. Null when the window is unknown or has no room.
 */
export function windowBar(context: ContextSettings, window: number | null): WindowBar | null {
  if (window === null || window <= 0 || window <= context.reply_reserve) return null;
  const room = window - context.reply_reserve;
  const pct = (tokens: number) => (tokens / window) * 100;
  const clear = pct(context.clear_at * room);
  const summarise = pct(context.compact_at * room);
  const replyFrom = pct(room);
  return {
    room,
    zones: [
      { kind: "work", from: 0, to: clear },
      { kind: "clear", from: clear, to: summarise },
      { kind: "summarise", from: summarise, to: replyFrom },
      { kind: "reply", from: replyFrom, to: 100 },
    ],
    marks: {
      clear: { at: clear, label: `${toPercent(context.clear_at)}%` },
      summarise: { at: summarise, label: `${toPercent(context.compact_at)}%` },
    },
  };
}

/** A span of the Right now text: the routing kinds, plus the tones of step 1 and step 2. */
export type ContextSpan = { kind: "text" | "chip" | "wait" | "summary"; text: string };

export type ContextRightNowInput = {
  context: ContextSettings;
  mode: RouteMode;
  local: { model: string; tokens: number | null; kind: "auto" | "fixed" | "ollama" } | null;
  hosted: { model: string; tokens: number; provider: string } | null;
};

const text = (value: string): ContextSpan => ({ kind: "text", text: value });
const chip = (value: string): ContextSpan => ({ kind: "chip", text: value });

/** The "Right now" card of Settings › Context. */
export function contextRightNow(input: ContextRightNowInput): ContextSpan[][] {
  const { context, mode, local, hosted } = input;
  const first: ContextSpan[] = [];
  if (local !== null) {
    if (local.kind === "ollama") first.push(text("Ollama picks the window for "), chip(local.model));
    else if (local.tokens === null) first.push(chip(local.model), text("'s window is not known yet"));
    else first.push(chip(local.model), text(" gets a "), chip(windowSize(local.tokens)), text(" window"));
    if (hosted !== null) {
      first.push(
        text("; "),
        chip(hosted.model),
        text(" has "),
        chip(windowSize(hosted.tokens)),
        text(`, set by ${providerName(hosted.provider)}`),
      );
    }
    first.push(text(". On any model, "));
  } else {
    first.push(text("On any model, "));
  }
  first.push(
    chip(windowSize(context.reply_reserve)),
    text(" stays free for the reply. At "),
    { kind: "wait", text: `${toPercent(context.clear_at)}%` },
    text(" full golem clears old tool results, and at "),
    { kind: "summary", text: `${toPercent(context.compact_at)}%` },
    text(" it summarises earlier turns."),
  );
  const ending =
    mode === "local"
      ? "When a chat still does not fit, it stops with a message."
      : "When a local chat still does not fit, the routing path steps up to a hosted model.";
  return [first, [text(`${CONTEXT_WORDS.nothingDeleted}${CONTEXT_WORDS.nothingDeletedMore} ${ending}`)]];
}

/** Where step 1 starts on a hosted model, to two figures: 137127 tokens is about 140K. */
function aboutSize(tokens: number): string {
  const digits = Math.pow(10, Math.max(0, Math.floor(Math.log10(tokens)) - 1));
  const rounded = Math.round(tokens / digits) * digits;
  return rounded >= 1000 ? `${rounded / 1000}K` : String(rounded);
}

const RARELY_RUNS_BELOW = 64_000;

/** The line under a hosted model's bar. */
export function hostedNote(provider: string, window: number, context: ContextSettings): string {
  const start = Math.max(0, window - context.reply_reserve) * context.clear_at;
  const rare = start >= RARELY_RUNS_BELOW ? ", so it rarely runs" : "";
  return `Window set by ${providerName(provider)}. Step 1 starts at about ${aboutSize(start)}${rare}.`;
}

/** The chips Routing shows beside its link to Settings › Context. */
export function handoffChips(context: ContextSettings, tokens: number | null, kind: "auto" | "fixed" | "ollama" = "auto"): string[] {
  const first =
    kind === "ollama" ? "Ollama's window" : tokens === null ? "window · auto" : `${windowSize(tokens)} window · ${kind}`;
  return [first, `clear at ${toPercent(context.clear_at)}%`, `summarise at ${toPercent(context.compact_at)}%`];
}
