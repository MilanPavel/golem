import type { ChatEvent, ConfigRouting, CostGetResult, ListedModel, ModelRoutedData, TraceRoute } from "@golem/client";

import { formatCost } from "./cost.ts";

// The route mode of a session, the ladder of tiers, and why a model was picked (ADR-055).
// Both clients show these words; neither writes its own.

export type RouteMode = "pinned" | "local" | "auto";
export type Tier = "local" | "budget" | "frontier";

/** The modes in the order the switch shows them. The permission mode has a `balanced`; this does not. */
export const ROUTE_MODE_NAMES: readonly RouteMode[] = ["pinned", "local", "auto"];

const ROUTE_LABELS: Readonly<Record<RouteMode, string>> = { pinned: "pinned", local: "local", auto: "auto" };

/** The word on the chip and the status line. */
export function routeLabel(mode: RouteMode): string {
  return ROUTE_LABELS[mode];
}

/** The switch's names and the line under each. */
export const ROUTE_CHOICES: readonly { mode: RouteMode; name: string; hint: string }[] = [
  { mode: "pinned", name: "Pinned", hint: "Always the model you chose." },
  { mode: "local", name: "Local only", hint: "Never a hosted model. Nothing leaves this Mac." },
  { mode: "auto", name: "Auto", hint: "Local first. A hosted model only when the rules allow it." },
];

export function isRouteMode(value: unknown): value is RouteMode {
  return value === "pinned" || value === "local" || value === "auto";
}

// --- the state the reducer keeps ---

/** The session's route mode, and the `model.routed` of each run. */
export type RouteState = {
  mode: RouteMode;
  /** The newest `model.routed` of each run, by run id. */
  routed: Readonly<Record<string, ModelRoutedData>>;
  /** The newest `model.routed` of all. */
  last: ModelRoutedData | null;
};

export const emptyRoute: RouteState = { mode: "pinned", routed: {}, last: null };

/** Fold one event: the mode from `session.created` and `session.updated`, the pick from `model.routed`. */
export function foldRoute(state: RouteState, event: ChatEvent): RouteState {
  if (event.type === "session.created" || event.type === "session.updated") {
    const mode = event.data.route;
    return mode == null || mode === state.mode ? state : { ...state, mode };
  }
  if (event.type === "model.routed") {
    const runId = event.run_id;
    const routed = runId == null ? state.routed : { ...state.routed, [runId]: event.data };
    return { ...state, routed, last: event.data };
  }
  return state;
}

// --- the note in a turn's footer ---

const RANK: Readonly<Record<Tier, number>> = { local: 0, budget: 1, frontier: 2 };

/** The model a session has: its profile or ref, the name the provider knows, and its tier when known. */
export type SessionModelRef = { profile: string | null; provider: string | null; name: string | null; tier: Tier | null };

/** The session's model with its tier from the model listing. The tier is null while the listing is not known. */
export function sessionModelOf(
  session: { profile: string | null; provider: string | null; name: string | null },
  models: readonly ListedModel[] | null | undefined,
): SessionModelRef {
  const ref = session.provider != null && session.name != null ? `${session.provider}/${session.name}` : null;
  const found = models == null ? undefined : (named(models, session.profile) ?? named(models, ref));
  return { ...session, tier: found?.tier ?? null };
}

/** The status line's route segment: the mode, and nothing on `pinned`. */
export function routeStatus(mode: RouteMode): string {
  return mode === "pinned" ? "" : routeLabel(mode);
}

function isSessionModel(routed: ModelRoutedData, session: SessionModelRef): boolean {
  const ref = routed.provider != null && routed.model != null ? `${routed.provider}/${routed.model}` : null;
  const own = [session.profile, session.name, session.provider != null && session.name != null ? `${session.provider}/${session.name}` : null];
  return own.some((name) => name !== null && (name === routed.model_profile || name === routed.model || name === ref));
}

/** The detail without the ` on <ref>` the daemon adds to name the model that did not fit. */
function plainDetail(routed: ModelRoutedData, session: SessionModelRef): string {
  const refs = [...(routed.rejected ?? []).map((row) => row.ref), session.profile ?? "", session.name ?? ""];
  for (const ref of refs) {
    if (ref !== "" && routed.detail.endsWith(` on ${ref}`)) return routed.detail.slice(0, -` on ${ref}`.length);
  }
  return routed.detail;
}

/**
 * The note before the model in an answer's footer: empty when the routed model is the session's,
 * else `↑ deepseek-chat · did not fit in 32K`. The arrow is there when the tier is above the session's.
 */
export function routedNote(routed: ModelRoutedData | null | undefined, session: SessionModelRef): string {
  if (routed?.replaces_model != null) return `tried again on ${routed.model ?? routed.model_profile}`;
  if (routed == null || routed.reason === "pinned" || isSessionModel(routed, session)) return "";
  const up = session.tier !== null && RANK[routed.tier] > RANK[session.tier];
  const model = routed.model ?? routed.model_profile;
  const detail = plainDetail(routed, session);
  return `${up ? "↑ " : ""}${model}${detail === "" ? "" : ` · ${detail}`}`;
}

// --- try again on a stronger model ---

/** The small action at the end of the last answer's footer. */
export const STRONGER_ACTION = "↑ stronger model";
/** What the daemon says when no stronger model may run. */
export const NO_STRONGER_NOTICE = "No stronger model is ready. Add a key in Settings.";

/** The ready model the ladder holds above the tier of the model that wrote the last answer. */
function strongerRow(models: readonly ListedModel[], routing: ConfigRouting | null | undefined, last: ModelRoutedData | null): LadderRow | undefined {
  if (last === null) return undefined;
  return ladderRows(models, routing).find((row) => row.ready && row.model !== null && RANK[row.tier] > RANK[last.tier]);
}

/**
 * `Try again on deepseek-chat`: the tooltip of the action and the words of `/stronger`, or null when
 * no ready model is above the model that wrote the last answer.
 */
export function strongerLabel(models: readonly ListedModel[], routing: ConfigRouting | null | undefined, last: ModelRoutedData | null): string | null {
  const row = strongerRow(models, routing, last);
  return row === undefined ? null : `Try again on ${row.model ?? ""}`;
}

/**
 * Whether the last answer offers `↑ stronger model`: the chat is idle, the route is `auto`, and a
 * ready model is above the one that wrote the answer. `/stronger` follows the same rule.
 */
export function canTryStronger(input: {
  mode: RouteMode;
  idle: boolean;
  models: readonly ListedModel[];
  routing: ConfigRouting | null | undefined;
  last: ModelRoutedData | null;
}): boolean {
  return input.mode === "auto" && input.idle && strongerLabel(input.models, input.routing, input.last) !== null;
}

/** The text of the last question the user asked, or null when there is none to send again. */
export function lastQuestion(messages: readonly { role: string; text: string }[]): string | null {
  const asked = [...messages].reverse().find((message) => message.role === "user" && message.text.trim() !== "");
  return asked === undefined ? null : asked.text;
}

// --- the ladder ---

export type LadderRow = {
  tier: Tier;
  /** The model's label, or null when the tier has none. */
  model: string | null;
  ref: string | null;
  provider: string | null;
  /** `ready · free`, `ready · $0.28 / M in`, `needs key`. */
  state: string;
  ready: boolean;
  /** The row has a model that waits for a key: the row offers `Add key`. */
  needsKey: boolean;
};

const TIERS: readonly Tier[] = ["local", "budget", "frontier"];

/** `$0.28 / M in`: the input price a model charges per million tokens. */
export function inputPrice(model: ListedModel): string {
  const price = model.price;
  if (price == null) return "";
  return `$${String(Number(price.input.toFixed(2)))} / M in`;
}

function stateOf(model: ListedModel): string {
  switch (model.status) {
    case "ready": {
      if (model.tier === "local" || (model.price != null && model.price.input === 0 && model.price.output === 0)) {
        return "ready · free";
      }
      const price = inputPrice(model);
      return price === "" ? "ready" : `ready · ${price}`;
    }
    case "needs_key":
      return "needs key";
    case "not_installed":
      return "not installed";
    case "pulling":
      return "downloading";
    case "server_down":
      return "not running";
  }
}

function named(models: readonly ListedModel[], name: string | null | undefined): ListedModel | undefined {
  if (name == null) return undefined;
  return models.find((model) => model.ref === name || (model.profiles ?? []).includes(name));
}

const blended = (model: ListedModel): number => (model.price == null ? Number.POSITIVE_INFINITY : (3 * model.price.input + model.price.output) / 4);

/**
 * One row for each tier: the model golem uses there and whether it is ready. A model `[routing.ladder]`
 * names wins. Else local is the session's own local model, or the local model with the biggest window;
 * budget is the cheapest ready one that takes tools; frontier is the session's own when it is one.
 */
export function ladderRows(
  models: readonly ListedModel[],
  routing: ConfigRouting | null | undefined,
  session: SessionModelRef | null = null,
): LadderRow[] {
  const own = session === null ? undefined : (named(models, session.profile) ?? named(models, session.provider != null && session.name != null ? `${session.provider}/${session.name}` : null));
  const set = routing?.ladder;
  const chosen: Record<Tier, ListedModel | undefined> = {
    local: named(models, set?.local),
    budget: named(models, set?.budget),
    frontier: named(models, set?.frontier),
  };
  if (chosen.local === undefined) {
    const local = models.filter((model) => model.tier === "local" && model.status === "ready");
    chosen.local = own?.tier === "local" ? own : local.sort((a, b) => (b.ctx ?? 0) - (a.ctx ?? 0) || a.ref.localeCompare(b.ref))[0];
  }
  if (chosen.budget === undefined) {
    const cheap = models.filter((model) => model.tier === "budget" && model.tools !== false && model.price != null);
    const best = (list: ListedModel[]): ListedModel | undefined => [...list].sort((a, b) => blended(a) - blended(b) || a.ref.localeCompare(b.ref))[0];
    chosen.budget = best(cheap.filter((model) => model.status === "ready")) ?? best(cheap.filter((model) => model.status === "needs_key"));
  }
  if (chosen.frontier === undefined && own?.tier === "frontier") chosen.frontier = own;
  return TIERS.map((tier) => {
    const model = chosen[tier];
    if (model === undefined) {
      return { tier, model: null, ref: null, provider: null, state: "no model", ready: false, needsKey: false };
    }
    return {
      tier,
      model: model.label,
      ref: model.ref,
      provider: model.provider,
      state: stateOf(model),
      ready: model.status === "ready",
      needsKey: model.status === "needs_key",
    };
  });
}

/** A ladder row as one line: `local     qwen3:27b   ready · free`. */
export function ladderLine(row: LadderRow): string {
  return `${row.tier.padEnd(8)}  ${(row.model ?? "-").padEnd(20)}  ${row.state}`.trimEnd();
}

// --- spend ---

export type SpendRow = {
  label: string;
  spent: number;
  /** The cap, null without one. */
  cap: number | null;
  /** Spent over cap, between 0 and 1. Null without a cap. */
  ratio: number | null;
  /** `Today $0.42 of $2.00`, or `Today $0.42` without a cap. */
  text: string;
};

function spendRow(label: string, spent: number, cap: number | null | undefined): SpendRow {
  const limit = cap ?? null;
  const money = (usd: number): string => `$${usd.toFixed(2)}`;
  return {
    label,
    spent,
    cap: limit,
    ratio: limit === null ? null : limit <= 0 ? 1 : Math.min(1, spent / limit),
    text: limit === null ? `${label} ${money(spent)}` : `${label} ${money(spent)} of ${money(limit)}`,
  };
}

/** Today's spend and this session's, each with its cap when there is one. */
export function spendRows(cost: CostGetResult | null | undefined, routing: ConfigRouting | null | undefined): SpendRow[] {
  if (cost == null) return [];
  return [
    spendRow("Today", cost.today.cost_usd, routing?.daily_usd),
    spendRow("This session", cost.session?.cost_usd ?? 0, routing?.session_usd),
  ];
}

// --- why this model ---

export type WhyRow = { model: string; tier: string; result: string };

/** The `Route: auto · reason: fit` line over the table. The mode is left out when it is not known. */
export function routeHeadline(reason: string, mode: RouteMode | null): string {
  return mode === null ? `Route · reason: ${reason}` : `Route: ${routeLabel(mode)} · reason: ${reason}`;
}

/** What `whyRows` reads: a `model.routed`, or the route of a run in the trace. */
export type WhyInput = {
  model?: string | null | undefined;
  model_profile?: string | undefined;
  tier?: Tier | null | undefined;
  detail: string;
  rejected?: readonly { ref: string; tier: Tier; why: string }[] | undefined;
};

/** The candidates table: the picked model first (`picked: <detail>`), then each rejected one with its reason. */
export function whyRows(routed: WhyInput): WhyRow[] {
  const picked: WhyRow = {
    model: routed.model ?? routed.model_profile ?? "-",
    tier: routed.tier ?? "-",
    result: `picked: ${routed.detail}`,
  };
  return [picked, ...(routed.rejected ?? []).map((row) => ({ model: row.ref, tier: row.tier, result: row.why }))];
}

/**
 * The route to show for a span of the trace: a run's own, and the first model call's of a run, whose
 * Metadata tab carries it. Null for any other span, and for a run of a pinned session.
 */
export function routeForSpan(
  runs: readonly { id: string; route?: TraceRoute | null; children?: readonly { id: string }[] }[],
  spanId: string,
): TraceRoute | null {
  for (const run of runs) {
    if (run.route == null) continue;
    if (run.id === spanId || run.children?.[0]?.id === spanId) return run.route;
  }
  return null;
}

/** `/route why` as plain lines: the headline, then the table with its columns padded. */
export function whyLines(routed: WhyInput & { reason: string }, mode: RouteMode | null): string[] {
  const rows = [{ model: "Model", tier: "Tier", result: "Result" }, ...whyRows(routed)];
  const width = (pick: (row: WhyRow) => string): number => Math.max(...rows.map((row) => pick(row).length));
  const [m, t] = [width((row) => row.model), width((row) => row.tier)];
  return [routeHeadline(routed.reason, mode), ...rows.map((row) => `${row.model.padEnd(m)}  ${row.tier.padEnd(t)}  ${row.result}`.trimEnd())];
}

/** `/route` alone in the web, which has the chip for the rest. */
export function routeReport(mode: RouteMode): string {
  return `Route: ${routeLabel(mode)}. The chip beside the mode has the ladder and the spend. /route pinned, local or auto sets it.`;
}

/** `/route why` on one line, for a notice: the pick, then the models that were left out. */
export function whySummary(route: Pick<RouteState, "last" | "mode">): string {
  const last = route.last;
  if (last === null) return "No model was routed in this chat yet.";
  const [picked, ...left] = whyRows(last);
  const head = `${routeHeadline(last.reason, route.mode)}. ${picked?.model ?? ""} ${picked?.result ?? ""}`.trimEnd();
  return left.length === 0 ? head : `${head}. Left out: ${left.map((row) => `${row.model} (${row.result})`).join(", ")}`;
}

/** What `/route` alone prints: the mode, the ladder, and the spend. */
export function routeReportLines(mode: RouteMode, ladder: readonly LadderRow[], spend: readonly SpendRow[]): string[] {
  const lines = [`Route: ${routeLabel(mode)}. /route pinned, local or auto sets it; /route why says why the last model.`];
  if (ladder.length > 0) lines.push("", "The ladder", ...ladder.map(ladderLine));
  if (spend.length > 0) lines.push("", ...spend.map((row) => row.text));
  return lines;
}

// --- the wait hint ---

/** What the hint above the composer assumes a hosted model takes to a first token, in seconds. */
export const HOSTED_FIRST_TOKEN_SECONDS = 2;
/** The first token is late enough to say so from this many seconds. */
export const WAIT_HINT_SECONDS = 60;

function waitText(seconds: number): string {
  if (seconds < 3600) return `≈ ${Math.round(seconds / 60)} min`;
  return `≈ ${Math.round(seconds / 3600)} h`;
}

/**
 * The line above the composer when a local model will be slow: `≈ 3 min to first token on qwen3:27b`,
 * and on `auto` with a ready budget model, ` · deepseek-chat ≈ 2 s for ≈ $0.01`. Empty when the session
 * is not local, the speed book has no figure, or the wait is under a minute. `inputTokens` is what the
 * last call sent.
 */
export function waitHint(input: {
  mode: RouteMode;
  session: ListedModel | undefined;
  models: readonly ListedModel[];
  routing: ConfigRouting | null | undefined;
  inputTokens: number | null;
}): string {
  const { session, inputTokens } = input;
  const tps = session?.speed?.prompt_tps;
  if (session === undefined || session.tier !== "local" || inputTokens === null || tps == null || tps <= 0) return "";
  const seconds = inputTokens / tps;
  if (seconds <= WAIT_HINT_SECONDS) return "";
  const text = `${waitText(seconds)} to first token on ${session.label}`;
  if (input.mode !== "auto") return text;
  const budget = ladderRows(input.models, input.routing).find((row) => row.tier === "budget");
  const model = budget === undefined || !budget.ready ? undefined : input.models.find((item) => item.ref === budget.ref);
  if (model === undefined) return text;
  const cost = model.price == null ? "" : ` for ≈ ${formatCost(Math.max(0.01, Math.ceil((inputTokens * model.price.input) / 1e4) / 100))}`;
  return `${text} · ${model.label} ≈ ${HOSTED_FIRST_TOKEN_SECONDS} s${cost}`;
}

/** The note for the footer of a turn: the pick of the run that wrote its steps. */
export function turnRoutedNote(
  steps: readonly { runId?: string | undefined }[],
  route: Pick<RouteState, "routed"> | undefined,
  session: SessionModelRef | null,
): string {
  if (route === undefined || session === null) return "";
  const runId = [...steps].reverse().find((step) => step.runId !== undefined)?.runId;
  return runId === undefined ? "" : routedNote(route.routed[runId], session);
}
