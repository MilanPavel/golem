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
    showOn: "Example:",
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
  rules: "This page holds the rules for every chat. A chat's live fill is the `ctx` chip in the chat.",
  windowAfterChat: "Ollama's window shows after the first chat on this model.",
  noPlan: {
    noSize: "Ollama has not reported this model's size yet",
    tooBig: "it is too big for this Mac's memory",
    other: "golem could not plan one",
  },
  sources: {
    golem: "planned by golem for this Mac",
    saved: "set for this model",
    modelfile: "from the model's Modelfile",
    ollama: "Ollama's default",
  },
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

/** Where the window a local model gets comes from, in the daemon's order. */
export type LocalWindowSource = "saved" | "fixed" | "golem" | "modelfile" | "ollama";

/** The window a local model really gets, and where it comes from. */
export type LocalWindow = {
  tokens: number | null;
  source: LocalWindowSource | null;
  /** True when the size is a forecast (the Modelfile's, or Ollama's default). */
  estimated: boolean;
  /** Why golem has no plan on Auto, or null. */
  reason: string | null;
};

export const NO_LOCAL_WINDOW: LocalWindow = { tokens: null, source: null, estimated: false, reason: null };

export type LocalWindowInput = {
  /** The `[context] window` setting. */
  setting: number | "auto" | "ollama";
  /** What `model.options` gave: the saved options, the defaults and where the default came from. Null while unknown. */
  options: { saved: Readonly<Record<string, unknown>>; defaults: Readonly<Record<string, unknown>>; from: string | undefined } | null;
  /** The model's listed maximum `ctx`, when known. */
  maxCtx: number | null;
  /** The listed size and fit of the model. */
  size_gb: number | null;
  fit: string | null;
};

const positive = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/** The window of a local model, in the order of the daemon's `resolve_window`: saved, fixed, golem's plan, the Modelfile, Ollama's default. */
export function localWindow(input: LocalWindowInput): LocalWindow {
  const { setting, options, maxCtx } = input;
  const saved = positive(options?.saved["num_ctx"]);
  const reason = noPlanReason(input);
  if (saved !== null) return { tokens: saved, source: "saved", estimated: false, reason };
  if (typeof setting === "number") {
    const tokens = maxCtx !== null && maxCtx > 0 ? Math.min(setting, maxCtx) : setting;
    return { tokens, source: "fixed", estimated: false, reason: null };
  }
  const value = positive(options?.defaults["num_ctx"]);
  const from = options?.from;
  if (value !== null && from === "golem" && setting === "auto") return { tokens: value, source: "golem", estimated: false, reason: null };
  const why = setting === "auto" ? reason : null;
  if (value !== null && from === "modelfile") return { tokens: value, source: "modelfile", estimated: true, reason: why };
  if (value !== null && from === "ollama") return { tokens: value, source: "ollama", estimated: true, reason: why };
  return { tokens: null, source: null, estimated: false, reason: why };
}

/** Why golem has no plan for the model on Auto. Null when it has one. */
function noPlanReason(input: LocalWindowInput): string | null {
  if (input.options?.from === "golem") return null;
  if (input.size_gb === null) return CONTEXT_WORDS.noPlan.noSize;
  if (input.fit === "too_big") return CONTEXT_WORDS.noPlan.tooBig;
  return CONTEXT_WORDS.noPlan.other;
}

/** A window size, with `≈` when it is a forecast. */
export function localSize(tokens: number, estimated: boolean): string {
  return `${estimated ? "≈ " : ""}${windowSize(tokens)}`;
}

/** `32K · planned by golem for this Mac`, `8K · set for this model`, `≈ 8K · Ollama's default`. Null for a Fixed window or none. */
export function localWindowLine(window: LocalWindow): string | null {
  if (window.tokens === null || window.source === null || window.source === "fixed") return null;
  return `${localSize(window.tokens, window.estimated)} · ${CONTEXT_WORDS.sources[window.source]}`;
}

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
  if (window === null) return shareBar(context);
  if (window <= 0 || window <= context.reply_reserve) return null;
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

/** The part of an unsized bar the reply takes, in percent. */
export const REPLY_SHARE = 8;

/** The bar with no window: the settings are shares of the room, and the reply part has a fixed narrow width. */
function shareBar(context: ContextSettings): WindowBar {
  const room = 100 - REPLY_SHARE;
  const clear = context.clear_at * room;
  const summarise = context.compact_at * room;
  return {
    room,
    zones: [
      { kind: "work", from: 0, to: clear },
      { kind: "clear", from: clear, to: summarise },
      { kind: "summarise", from: summarise, to: room },
      { kind: "reply", from: room, to: 100 },
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
  local: ({ model: string; kind: "auto" | "fixed" | "ollama" } & LocalWindow) | null;
  hosted: { model: string; tokens: number; provider: string } | null;
};

const text = (value: string): ContextSpan => ({ kind: "text", text: value });
const chip = (value: string): ContextSpan => ({ kind: "chip", text: value });

/** The "Right now" card of Settings › Context. */
export function contextRightNow(input: ContextRightNowInput): ContextSpan[][] {
  const { context, mode, local, hosted } = input;
  const first: ContextSpan[] = [];
  if (local !== null) {
    if (local.tokens !== null) {
      first.push(chip(local.model), text(" gets a "), chip(localSize(local.tokens, local.estimated)), text(" window"));
      if (local.source !== null && local.source !== "fixed") first.push(text(` (${CONTEXT_WORDS.sources[local.source]})`));
    } else if (local.kind === "ollama") first.push(text("Ollama picks the window for "), chip(local.model));
    else first.push(chip(local.model), text("'s window is not known yet"));
    if (local.tokens === null && local.reason !== null) first.push(text(` (${local.reason})`));
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
export function handoffChips(context: ContextSettings, window: LocalWindow, kind: "auto" | "fixed" | "ollama" = "auto"): string[] {
  const first =
    window.tokens !== null
      ? `${localSize(window.tokens, window.estimated)} window · ${kind}`
      : kind === "ollama"
        ? "Ollama's window"
        : "window · auto";
  return [first, `clear at ${toPercent(context.clear_at)}%`, `summarise at ${toPercent(context.compact_at)}%`];
}
