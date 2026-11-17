/** The words and small rules of Settings › Routing, for every client that shows them. */

export type RouteMode = "pinned" | "local" | "auto";
export type PaidChoice = "ask" | "always_ask" | "never";
export type OverChoice = "local" | "ask";

export type RoutingChoice<T extends string> = { value: T; title: string; line: string };

/** The three routes, in the order of the page. */
export const ROUTE_MODES: readonly RoutingChoice<RouteMode>[] = [
  { value: "auto", title: "Auto", line: "Starts on this Mac. Steps up to a hosted model only when it has to." },
  { value: "local", title: "Local only", line: "Only models on this Mac. Nothing is sent to a hosted provider." },
  { value: "pinned", title: "Pinned", line: "Each chat stays on the one model you picked for it." },
];

export const PAID_CHOICES: readonly RoutingChoice<PaidChoice>[] = [
  { value: "ask", title: "Ask once per chat", line: "Asks before the first paid call. Remembers your answer for that chat." },
  { value: "always_ask", title: "Ask every time", line: "Asks before every paid turn. Remembers nothing." },
  { value: "never", title: "Never pay", line: "The gate stays closed. Paid models are never used." },
];

export const OVER_CHOICES: readonly RoutingChoice<OverChoice>[] = [
  { value: "local", title: "stay local", line: "" },
  { value: "ask", title: "ask me", line: "" },
];

/** The titles and lines of the parts of the page. */
export const ROUTING_WORDS = {
  lead: "Which model answers each turn, and when golem may spend money.",
  rightNow: "Right now",
  route: { title: "How a new chat picks its model", line: "You can change it for one chat at any time." },
  path: {
    title: "The path of a turn",
    line: "Three steps, cheapest first. Pick a model for a step, or leave it on Auto and golem picks.",
    start: "every turn starts here",
    answer: "answers here",
    pinned:
      "Pinned: the steps are not used. Each chat stays on the model in its model chip. A pinned hosted model is paid without a question; the spending limits still stop it.",
    noFrontier: "No model is ready for this step, so the path ends at Budget.",
    addKey: "Add an API key",
    notChosen: "No model is chosen for this step, so the path ends at Budget.",
    choose: "Choose a model",
    gateGo: "Go to the paid gate settings",
  },
  try: { title: "Try it.", line: "Pick a situation and see where the turn goes with these settings.", idle: "Nothing picked yet." },
  gate: {
    title: "The paid gate",
    line: "What stands between a free local model and a model that costs money.",
    before: "Before golem pays",
    beforeLine: "The question shows the model, the reason and the price.",
    limits: "Spending limits",
    limitsLine: "In US dollars. Empty means no limit.",
    day: "Per day",
    chat: "Per chat",
    over: "When a limit is reached",
  },
  exceptions: {
    title: "Exceptions and small jobs",
    folders: "Folders that never leave this Mac",
    foldersLine: "A chat in one of these folders is local only, whatever the settings above say.",
    noFolders: "No folders yet.",
    addFolder: "Add a folder",
    jobs: "Small jobs",
    jobsLine: "Three things golem does beside answering you. The list is fixed; you choose the model for each.",
    automatic: "Automatic",
    automaticNote:
      "Automatic means: on a local chat, the chat's own model, so no second model has to load. On a hosted chat, the cheapest ready Budget model.",
  },
  more: "More",
} as const;

/** The three tiers of the path, with what each holds. */
export const LADDER_TIERS = [
  { tier: "local", title: "Local", line: "Runs on this Mac. Private." },
  { tier: "budget", title: "Budget", line: "A cheap hosted model with a big window." },
  { tier: "frontier", title: "Frontier", line: "The strongest hosted model." },
] as const;

/** What the arrow into a step says. */
export const LINK_WHY = {
  gate: "when the prompt does not fit, or the model struggles",
  frontier: "when Budget is not enough",
} as const;

export const ROLES = [
  { role: "titles", title: "Titles", line: "Names a new chat after your first message." },
  { role: "summarise", title: "Summaries", line: "Writes the summary of earlier turns (step 2 below, and /compact)." },
  { role: "explore", title: "Explorer", line: "A helper that reads many files for one question and reports back." },
] as const;

function modelName(ref: string): string {
  const at = ref.indexOf("/");
  return at < 0 ? ref : ref.slice(at + 1);
}

/** A model reference as a person reads it: `qwen3:27b` for `ollama/qwen3:27b`. */
export function shortModel(ref: string): string {
  return modelName(ref);
}

/** `Auto · qwen3:27b`, or `Auto · nothing is ready` when golem has nothing to pick. */
export function autoLine(ref: string | null): string {
  return ref === null ? "Auto · nothing is ready" : `Auto · ${modelName(ref)}`;
}

/** Who picked the model of a step. */
export function pickedBy(chosen: boolean): string {
  return chosen ? "your choice" : "picked by golem";
}

// An assumed typical turn, to say about what a paid step costs.
const TURN_INPUT_TOKENS = 6000;
const TURN_OUTPUT_TOKENS = 500;

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** The cost of a turn on a model, `$0.12`, from its price in USD per million tokens. */
export function turnCost(price: { input: number; output: number }): string {
  return usd((TURN_INPUT_TOKENS * price.input + TURN_OUTPUT_TOKENS * price.output) / 1_000_000);
}

/** The price tag of a step: `free`, `≈ $0.12 a turn` from the model's price, or `paid` when unknown. */
export function priceTag(tier: "local" | "budget" | "frontier", price: { input: number; output: number } | null): string {
  if (tier === "local") return "free";
  if (price === null) return "paid";
  if (price.input === 0 && price.output === 0) return "free";
  const cost = (TURN_INPUT_TOKENS * price.input + TURN_OUTPUT_TOKENS * price.output) / 1_000_000;
  return cost < 0.01 ? "< $0.01 a turn" : `≈ ${usd(cost)} a turn`;
}

// --- the summary, the gate and the try-it results ---

/** What the settings say, as a client reads them. A model is its short name, or null when none is ready. */
export type RoutingState = {
  mode: RouteMode;
  paid: PaidChoice;
  over: OverChoice;
  /** The limits in US dollars; null is no limit. */
  daily: number | null;
  chat: number | null;
  local: string | null;
  budget: string | null;
  frontier: string | null;
  /** About what a Budget turn costs, as `$0.01`, or null when the price is not known. */
  budgetCost: string | null;
  /** The planned window of the local model, as `32K`, or null when it is not known. */
  window: string | null;
};

export type Span = { kind: "text" | "chip" | "money" | "free"; text: string };
const text = (value: string): Span => ({ kind: "text", text: value });
const chip = (value: string): Span => ({ kind: "chip", text: value });
const money = (value: string): Span => ({ kind: "money", text: value });
const free = (value: string): Span => ({ kind: "free", text: value });

function limitsLine(state: RoutingState): Span[] {
  const parts: Span[] = [];
  if (state.daily !== null) parts.push(money(`${usd(state.daily)} a day`));
  if (state.chat !== null) {
    if (parts.length > 0) parts.push(text(" or "));
    parts.push(money(`${usd(state.chat)} a chat`));
  }
  if (parts.length === 0) return [text("There is no spending limit.")];
  const after = state.over === "local" ? "then it stays local" : "then it asks you";
  return [text("It stops paying at "), ...parts, text(`; ${after}.`)];
}

/** The "Right now" text: paragraphs of spans, so a client can style the chips, the money and the free. */
export function routingSummary(state: RoutingState): Span[][] {
  const local = chip(state.local ?? "a local model");
  const budget = chip(state.budget ?? "a Budget model");
  if (state.mode === "local") {
    return [
      [text("Every turn runs on "), local, text(" on this Mac. Nothing is sent to a hosted provider, and nothing costs money.")],
      [text("When a chat gets long, golem clears old tool results and summarises earlier turns to stay inside the window.")],
    ];
  }
  if (state.mode === "pinned") {
    return [
      [text("Each chat stays on the one model you pick for it. golem never switches models by itself.")],
      [text("A pinned hosted model is paid without a question. "), ...limitsLine(state)],
    ];
  }
  if (state.paid === "never") {
    return [
      [text("Every turn starts on "), local, text(" on this Mac, "), free("free"), text(", and stays there: golem never pays for a model.")],
      [text("A prompt that cannot fit even after clearing and summarising stops with a message.")],
    ];
  }
  const ask = state.paid === "ask" ? "asks you once per chat" : "asks you every time";
  const top = state.frontier === null ? [] : [text(" If that is still not enough, it goes on to "), chip(state.frontier), text(".")];
  return [
    [
      text("Every turn starts on "),
      local,
      text(" on this Mac, "),
      free("free"),
      text(`. When the prompt does not fit or the model struggles, golem ${ask}, then steps up to `),
      budget,
      text("."),
      ...top,
    ],
    [...limitsLine(state), ...(state.frontier === null ? [text(" No Frontier model is ready, so the path ends at Budget.")] : [])],
  ];
}

/** Paragraphs of spans as one plain string. */
export function spansText(paragraphs: readonly (readonly Span[])[]): string {
  return paragraphs.map((spans) => spans.map((span) => span.text).join("")).join(" ");
}

/** What the gate on the path says. */
export function gateLabel(state: Pick<RoutingState, "mode" | "paid">): string {
  if (state.mode === "local") return "closed · local only";
  if (state.mode === "pinned") return "not used";
  if (state.paid === "never") return "closed";
  return state.paid === "ask" ? "asks once" : "asks every time";
}

/** Whether the paid steps are out of use: the route or the gate is closed. */
export function pathClosed(state: Pick<RoutingState, "mode" | "paid">): boolean {
  return state.mode !== "auto" || state.paid === "never";
}

export type Situation = "quick" | "too_big" | "struggles" | "limit_spent" | "local_only_folder";
export type PathPart = "local" | "gate" | "budget" | "frontier";
export type PartState = "pass" | "hit" | "ask" | "stop";
export type Outcome = {
  parts: readonly { part: PathPart; state: PartState }[];
  mark: "ok" | "pays" | "stops";
  sentence: Span[];
};

/** The situations of "Try it", with their buttons. */
export function situations(window: string | null): readonly { value: Situation; label: string }[] {
  return [
    { value: "quick", label: "A quick question" },
    { value: "too_big", label: `A prompt too big for ${window ?? "the window"}` },
    { value: "struggles", label: "The local model fumbles twice" },
    { value: "limit_spent", label: "Today's limit is spent" },
    { value: "local_only_folder", label: "A chat in a local-only folder" },
  ];
}

/** Where a turn goes in a situation, with these settings: the parts it passes, a mark and what golem does. */
export function turnOutcome(situation: Situation, state: RoutingState): Outcome {
  const local = chip(state.local ?? "a local model");
  const budget = chip(state.budget ?? "a Budget model");
  const stay = [
    { part: "local", state: "hit" },
    { part: "gate", state: "stop" },
  ] as const;
  const up = [
    { part: "local", state: "pass" },
    { part: "gate", state: "ask" },
    { part: "budget", state: "hit" },
  ] as const;
  if (state.mode === "pinned") {
    const big = situation === "too_big" ? " If the prompt cannot fit after clearing and summarising, the turn stops and says why." : "";
    return { parts: [], mark: "ok", sentence: [text(`Pinned: the turn runs on the chat's own model. golem does not switch.${big}`)] };
  }
  if (situation === "quick") {
    return { parts: [{ part: "local", state: "hit" }], mark: "ok", sentence: [local, text(" answers on this Mac. Free. The gate is never reached.")] };
  }
  if (situation === "local_only_folder" || state.mode === "local") {
    const why = situation === "local_only_folder" ? "The folder is local only" : "The route is local only";
    return {
      parts: stay,
      mark: "ok",
      sentence: [
        text(`${why}: `),
        local,
        text(" answers, and golem never asks about paying. If a prompt cannot fit, golem clears and summarises; then the turn stops and says why."),
      ],
    };
  }
  if (state.paid === "never") {
    if (situation === "too_big") {
      return {
        parts: stay,
        mark: "stops",
        sentence: [text("golem clears old tool results and summarises. If the prompt still cannot fit, the turn stops with a message. Nothing is paid.")],
      };
    }
    return { parts: stay, mark: "ok", sentence: [text("The gate is closed, so the turn stays on "), local, text(". Nothing is paid.")] };
  }
  if (situation === "limit_spent") {
    if (state.daily === null && state.chat === null) {
      return { parts: [], mark: "ok", sentence: [text("No limit is set, so this cannot happen. Set one in the paid gate below.")] };
    }
    if (state.over === "local") {
      return { parts: stay, mark: "ok", sentence: [text("The limit is reached, so the turn stays on "), local, text(". A line in the chat says so.")] };
    }
    return {
      parts: up,
      mark: "pays",
      sentence: [text("The limit is reached, so golem asks before it pays more. After a yes, "), budget, text(" answers.")],
    };
  }
  if (situation === "too_big") {
    const once = state.paid === "ask" ? "once" : "this time too";
    const cost = state.budgetCost === null ? "" : ` for about ${state.budgetCost}`;
    return {
      parts: up,
      mark: "pays",
      sentence: [
        text(
          `First golem clears old tool results and summarises, which is free. Still too big: it asks ${once} (allow for this chat, only this turn, or stay local). After a yes, `,
        ),
        budget,
        text(` answers${cost}.`),
      ],
    };
  }
  if (state.paid === "always_ask") {
    return {
      parts: stay,
      mark: "ok",
      sentence: [
        text(`golem cannot stop to ask in the middle of a run, and "ask every time" remembers no yes. The run finishes on `),
        local,
        text("."),
      ],
    };
  }
  return {
    parts: up,
    mark: "pays",
    sentence: [
      text("If you already said yes in this chat, the run moves to "),
      budget,
      text(" once and goes on. Without a yes it finishes on "),
      local,
      text(", because golem does not stop a run to ask."),
    ],
  };
}

// --- the long-chat chart ---

export type ChartMark = { x: number; pct: number; kind: "clear" | "summary" };

/** The chart of a long chat. `x` runs from 0 to 1 along the chat; every `pct` is a percent of the window. */
export type ContextChart = {
  line: readonly { x: number; pct: number }[];
  marks: readonly ChartMark[];
  /** Where clearing starts and where summarising starts. */
  clearAt: number;
  compactAt: number;
  /** The share of the window kept for the reply: the band at the top. */
  reply: number;
};

export type ContextSettings = { reply_reserve: number; clear_at: number; clear_to: number; compact_at: number };

/**
 * A long chat as a line: three clears that work, one that frees little, then a summary. The shares of
 * `[context]` count against the window minus `reply_reserve`, so the line stays under the reply band.
 * Null when the window is not known.
 */
export function contextChart(context: ContextSettings, window: number | null): ContextChart | null {
  if (window === null || window <= 0) return null;
  const reply = Math.min(100, (context.reply_reserve / window) * 100);
  const scale = (100 - reply) / 100;
  const at = context.clear_at * 100 * scale;
  const sum = context.compact_at * 100 * scale;
  const to = context.clear_to * 100 * scale;
  const small = Math.min(30 * scale, to);
  const weak = Math.max(to, at - 6);
  const plan: readonly [number, number, ChartMark["kind"]][] = [
    [at, to, "clear"],
    [at, to, "clear"],
    [at, weak, "clear"],
    [sum, small, "summary"],
    [at, to, "clear"],
  ];
  const start = Math.min(6, at / 2);
  let total = 0;
  let from = start;
  for (const [high, back] of plan) {
    total += Math.max(0, high - from);
    from = back;
  }
  const tail = 0.05;
  const line: { x: number; pct: number }[] = [{ x: 0, pct: start }];
  const marks: ChartMark[] = [];
  let x = 0;
  let low = start;
  for (const [high, back, kind] of plan) {
    x += total > 0 ? (Math.max(0, high - low) / total) * (1 - tail) : 0;
    line.push({ x, pct: high });
    marks.push({ x, pct: high, kind });
    line.push({ x, pct: back });
    low = back;
  }
  line.push({ x: Math.min(1, x + tail), pct: low + Math.min(6, Math.max(0, at - low)) });
  return { line, marks, clearAt: at, compactAt: sum, reply };
}

/** The legend under the chart. */
export const CHART_LEGEND =
  "Each dot is golem clearing old results: the chat drops back to about 40% and goes on. The third time there was little to clear, so the chat kept growing and golem summarised (the square). The line never reaches the grey band, so nothing is cut silently.";

/** The line under the reply setting, with the worked example. */
export function roomExample(window: number | null, reserve: number): string {
  const lead = "A part of the window golem never fills with the chat, so the answer has space.";
  if (window === null) return lead;
  const room = Math.max(0, window - reserve);
  return `${lead} With a ${windowSize(window)} window and ${windowSize(reserve)} kept, the chat may use ${windowSize(room)}. The percentages below count against those ${windowSize(room)}.`;
}

/** The stage labels of the long-chat part. */
export function stageLabels(context: Pick<ContextSettings, "clear_at" | "compact_at">): { always: string; one: string; two: string } {
  return {
    always: "always",
    one: `step 1 · at ${toPercent(context.clear_at)}% full · free`,
    two: `step 2 · at ${toPercent(context.compact_at)}% full · one model call`,
  };
}

/** A window size the way a person says it: `32K` for 32768, `41.5K` for 41500, `900` below 1000. */
export function windowSize(tokens: number): string {
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(tokens);
}

/**
 * What Auto gives for a local model on this Mac: `Auto picks 32K for qwen3:27b on this Mac (36 GB).`
 * Null when golem has no plan for the model, so there is nothing to say.
 */
export function windowCaption(model: string | null, tokens: number | null, ramGb: number | null): string | null {
  if (model === null || tokens === null) return null;
  const memory = ramGb === null ? "" : ` (${Math.round(ramGb)} GB)`;
  return `Auto picks ${windowSize(tokens)} for ${modelName(model)} on this Mac${memory}.`;
}

export type Parsed = { ok: true; value: number | null } | { ok: false; message: string };

/** A number typed in a box. Empty is null, which clears the setting. */
export function parseAmount(text: string): Parsed {
  const trimmed = text.trim().replace(/^\$/, "");
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, message: "Enter a number." };
  return { ok: true, value };
}

/** A share of the window, 0.7, as the percent a person types, 70. */
export function toPercent(share: number): string {
  return String(Math.round(share * 10_000) / 100);
}

/** The percent a person typed, `70` or `70%`, as a share, 0.7. */
export function parsePercent(text: string): Parsed {
  const parsed = parseAmount(text.trim().replace(/%$/, ""));
  if (!parsed.ok || parsed.value === null) return parsed;
  return { ok: true, value: Math.round(parsed.value * 100) / 10_000 };
}
