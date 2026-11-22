import type { ChatEvent, ListedModel } from "@golem/client";

import type { ChatState, HelperRef, ToolBlock } from "./chat-state.ts";
import type { Detail } from "./activity.ts";
import { formatCost } from "./cost.ts";
import { formatElapsed } from "./duration.ts";
import { helperCounts, helperStopWords } from "./helper.ts";
import { waitText, type WaitLength, type WaitReason, type WaitState } from "./wait.ts";

/**
 * The model of the batch card (ADR-059): one card for the helpers of one `delegate` call, at the
 * chat's detail level. Pure: the web and the terminal draw it, neither adds a word.
 */

/** Where a helper is. `stopped` is a helper that ended on a limit or was cancelled. */
export type HelperState = "queued" | "running" | "waiting" | "done" | "failed" | "stopped";

/** One helper of a batch, from the lead's log. */
export type BatchHelper = {
  index: number;
  /** The short name the card shows. Falls back to the agent type. */
  label: string;
  agent: string;
  model: string | null;
  /** What the agent file wished for, and why this model came out of it, in plain words. */
  wish: string | null;
  pickReason: string | null;
  /** True on a local model, false on a cloud one, null when nobody said. */
  local: boolean | null;
  state: HelperState;
  /** The wait reason of `helper.state`, a plain string. */
  reason: string | null;
  /** The reason it ended: `done`, `calls`, `time`, `cost`, `budget`, `tokens`, `cancelled` or `failed`. Null while it runs. */
  stopped: string | null;
  steps: ToolBlock[];
  /** Tokens the helper used, and the size of its answer. Null until it ends. */
  tokens: number | null;
  answerTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
};

/** The helpers of one `delegate` call, in the order of the call. */
export type HelperBatch = {
  callId: string;
  helpers: BatchHelper[];
  /** The lead is parked and waits for them, from `helper.wait`. */
  parked: boolean;
};

/** Whether a model runs on this machine. Return null when you cannot tell. */
export type IsLocal = (model: string) => boolean | null;

const WAIT_REASONS: readonly string[] = ["slot", "load", "provider", "team", "budget", "you", "stalled"];

function blank(index: number): BatchHelper {
  return {
    index,
    label: "",
    agent: "",
    model: null,
    wish: null,
    pickReason: null,
    local: null,
    state: "queued",
    reason: null,
    stopped: null,
    steps: [],
    tokens: null,
    answerTokens: null,
    costUsd: null,
    durationMs: null,
  };
}

function withHelper(batch: HelperBatch, index: number, change: (helper: BatchHelper) => BatchHelper): HelperBatch {
  const known = batch.helpers.some((helper) => helper.index === index);
  const next = known ? batch.helpers.map((helper) => (helper.index === index ? change(helper) : helper)) : [...batch.helpers, change(blank(index))];
  return { ...batch, helpers: [...next].sort((a, b) => a.index - b.index) };
}

function endState(stopped: string): HelperState {
  if (stopped === "done") return "done";
  return stopped === "failed" ? "failed" : "stopped";
}

/** An empty batch for a `delegate` call. */
export function emptyBatch(callId: string): HelperBatch {
  return { callId, helpers: [], parked: false };
}

/**
 * The batch after one event of the lead's log. Events of other calls and other types change nothing.
 * `isLocal` says what a model is; without it the card tells by cost once the helper ended.
 */
export function reduceBatch(batch: HelperBatch, event: ChatEvent, isLocal: IsLocal = () => null): HelperBatch {
  switch (event.type) {
    case "helper.started": {
      const data = event.data;
      if (data.call_id !== batch.callId) return batch;
      return withHelper(batch, data.index, (helper) => ({
        ...helper,
        label: data.label,
        agent: data.agent,
        model: data.model,
        wish: data.wish,
        pickReason: data.pick_reason === "" ? null : data.pick_reason,
        local: isLocal(data.model),
      }));
    }
    case "helper.model": {
      // A no to the paid question: the model that ran and why replace the paid one `helper.started` named.
      const data = event.data;
      if (data.call_id !== batch.callId) return batch;
      return withHelper(batch, data.index, (helper) => ({
        ...helper,
        model: data.model,
        pickReason: data.pick_reason === "" ? null : data.pick_reason,
        local: isLocal(data.model),
      }));
    }
    case "helper.state": {
      const data = event.data;
      if (data.call_id !== batch.callId) return batch;
      return withHelper(batch, data.index, (helper) => ({ ...helper, state: data.state, reason: data.reason ?? null }));
    }
    case "helper.step": {
      const data = event.data;
      if (data.call_id !== batch.callId) return batch;
      return withHelper(batch, data.index, (helper) => {
        const summary = data.summary == null ? {} : { summary: data.summary };
        const known = helper.steps.some((step) => step.callId === data.step_id);
        const steps = known
          ? helper.steps.map((step) => (step.callId === data.step_id ? { ...step, status: data.status, ...summary } : step))
          : [...helper.steps, { callId: data.step_id, name: data.name, args: data.args ?? {}, status: data.status, ...summary }];
        return { ...helper, steps, state: helper.state === "queued" ? "running" : helper.state };
      });
    }
    case "helper.wait": {
      if (event.data.call_id !== batch.callId) return batch;
      return { ...batch, parked: event.data.state === "parked" };
    }
    case "helper.ended": {
      const data = event.data;
      if (data.call_id !== batch.callId) return batch;
      return withHelper(batch, data.index, (helper) => ({
        ...helper,
        state: endState(data.stopped),
        reason: null,
        stopped: data.stopped,
        tokens: data.tokens,
        answerTokens: data.answer_tokens,
        costUsd: data.cost_usd,
        durationMs: data.duration_ms,
        // A cloud model that cost nothing is not a thing, so a cost says cloud when nobody did.
        local: helper.local ?? (data.cost_usd > 0 ? false : null),
      }));
    }
    default:
      return batch;
  }
}

/**
 * `IsLocal` from the model list: a model is local when the listing says its tier is local. The helper's
 * model is a `provider/name` ref or a bare name. Null when the list does not have it.
 */
export function isLocalFrom(models: readonly Pick<ListedModel, "ref" | "tier">[] | null | undefined): IsLocal {
  return (model) => {
    const found = models?.find((item) => item.ref === model || item.ref.endsWith(`/${model}`));
    return found === undefined ? null : found.tier === "local";
  };
}

/** The batch with each helper's `local` told by `isLocal` where it can say, so a model list can come after the fold. */
export function withLocal(batch: HelperBatch, isLocal: IsLocal): HelperBatch {
  return {
    ...batch,
    helpers: batch.helpers.map((helper) => {
      const local = helper.model === null ? null : isLocal(helper.model);
      return local === null ? helper : { ...helper, local };
    }),
  };
}

/** The batch of one `delegate` call, folded from a lead's events. */
export function foldBatch(callId: string, events: readonly ChatEvent[], isLocal: IsLocal = () => null): HelperBatch {
  return events.reduce((batch, event) => reduceBatch(batch, event, isLocal), emptyBatch(callId));
}

/** A window figure: `14K`, `0.6K`, and the plain count below 100. */
export function windowK(tokens: number): string {
  if (tokens < 100) return String(tokens);
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}K`;
  const k = (Math.round(tokens / 100) / 10).toFixed(1);
  return `${k.endsWith(".0") ? k.slice(0, -2) : k}K`;
}

/** `14K to 0.6K`: what the helper read, and what came back to the lead's window. Null before it ended. */
export function windowSaved(tokens: number | null, answerTokens: number | null): string | null {
  if (tokens === null || answerTokens === null) return null;
  return `${windowK(tokens)} to ${windowK(answerTokens)}`;
}

/**
 * The number on a helper's row. A local model costs nothing, so it shows the window saved
 * (`14K to 0.6K`). A cloud model shows the cost first, then the window (`$0.04 · 14K to 0.6K`).
 * Null while the helper runs.
 */
export function helperNumber(helper: Pick<BatchHelper, "local" | "tokens" | "answerTokens" | "costUsd">): string | null {
  const saved = windowSaved(helper.tokens, helper.answerTokens);
  if (helper.local === true) return saved;
  const cost = helper.costUsd === null ? "" : formatCost(helper.costUsd);
  return [cost, saved].filter((part): part is string => part !== null && part !== "").join(" · ") || null;
}

/** The right column of a row: the state, or the reason it waits, or why it stopped. */
export function helperRight(helper: Pick<BatchHelper, "state" | "reason" | "stopped" | "model">, length: WaitLength = "web"): string {
  switch (helper.state) {
    case "queued":
    case "waiting": {
      const reason = helper.reason;
      if (reason !== null && WAIT_REASONS.includes(reason)) {
        const wait: WaitState = {
          reason: reason as WaitReason,
          line: null,
          model: helper.model,
          position: null,
          holder: null,
          retryInMs: null,
          silentMs: null,
          scope: null,
          willRetry: null,
        };
        return waitText(wait, length);
      }
      return reason !== null && reason !== "" ? `${helper.state} · ${reason}` : helper.state;
    }
    case "running":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "stopped":
      return helperStopWords(helper.stopped ?? "") || "stopped";
  }
}

/** The tone of a row, for its colour: a wait or a stop is a warning, a failure an error. */
export type CardTone = "run" | "ok" | "wait" | "bad";

function toneOf(state: HelperState): CardTone {
  switch (state) {
    case "running":
      return "run";
    case "done":
      return "ok";
    case "queued":
    case "waiting":
    case "stopped":
      return "wait";
    case "failed":
      return "bad";
  }
}

/** One row of the card. `right` is always a state or a wait reason; `number` sits before it. */
export type CardRow = {
  /** `explorer`, or the label the lead gave it. */
  name: string;
  /** What ran: `read 13 files, 3 searches`. Empty before it made a call. */
  ran: string;
  /** The model and why it was picked, at Verbose only. Empty otherwise. */
  model: string;
  number: string | null;
  right: string;
  tone: CardTone;
  /** How long it took, once it ended. */
  took: string | null;
};

export type BatchCard = {
  detail: Detail;
  /** The first line: `3 helpers · 2 done · 1 running`. At Quiet, this is the whole card. */
  head: string;
  /** The same line, with the number of the whole batch, at Normal and Verbose. */
  total: string | null;
  /** Empty at Quiet. */
  rows: CardRow[];
  /** The right column of the head: the one wait of the batch, or its state. */
  right: string;
  tone: CardTone;
};

function nameOf(helper: BatchHelper): string {
  return helper.label !== "" ? helper.label : helper.agent !== "" ? helper.agent : `helper ${String(helper.index + 1)}`;
}

function modelLine(helper: BatchHelper): string {
  const model = helper.model ?? "";
  const why = helper.pickReason ?? "";
  if (model === "") return why;
  return why === "" ? model : `${model} · ${why}`;
}

function countWord(count: number): string {
  return `${String(count)} ${count === 1 ? "helper" : "helpers"}`;
}

/** `3 helpers · 2 done · 1 running`: states in a fixed order, only those that exist. */
export function batchHead(helpers: readonly Pick<BatchHelper, "state">[]): string {
  if (helpers.length === 0) return "starting helpers";
  const order: readonly HelperState[] = ["running", "waiting", "queued", "done", "stopped", "failed"];
  const parts = order
    .map((state) => [state, helpers.filter((helper) => helper.state === state).length] as const)
    .filter(([, count]) => count > 0)
    .map(([state, count]) => `${String(count)} ${state}`);
  return [countWord(helpers.length), ...parts].join(" · ");
}

/** The number of the whole batch: window saved when every helper was local, cost first when one was not. */
export function batchNumber(helpers: readonly BatchHelper[]): string | null {
  const ended = helpers.filter((helper) => helper.tokens !== null && helper.answerTokens !== null);
  if (ended.length === 0) return null;
  const tokens = ended.reduce((sum, helper) => sum + (helper.tokens ?? 0), 0);
  const answers = ended.reduce((sum, helper) => sum + (helper.answerTokens ?? 0), 0);
  const costs = ended.map((helper) => helper.costUsd).filter((cost): cost is number => cost !== null);
  const cost = costs.length === 0 ? null : costs.reduce((sum, value) => sum + value, 0);
  const local = ended.every((helper) => helper.local === true);
  return helperNumber({ local, tokens, answerTokens: answers, costUsd: cost });
}

function batchRight(batch: HelperBatch, length: WaitLength): { text: string; tone: CardTone } {
  const open = batch.helpers.filter((helper) => helper.state === "running" || helper.state === "waiting" || helper.state === "queued");
  const asking = open.find((helper) => helper.reason === "you");
  if (asking !== undefined) return { text: helperRight(asking, length), tone: "wait" };
  if (open.length > 0) return { text: batch.parked ? waitText(teamWait(), length) : "running", tone: "run" };
  if (batch.helpers.some((helper) => helper.state === "failed")) return { text: "failed", tone: "bad" };
  if (batch.helpers.some((helper) => helper.state === "stopped")) return { text: "stopped", tone: "wait" };
  return { text: batch.helpers.length === 0 ? "starting" : "done", tone: batch.helpers.length === 0 ? "run" : "ok" };
}

function teamWait(): WaitState {
  return { reason: "team", line: null, model: null, position: null, holder: null, retryInMs: null, silentMs: null, scope: null, willRetry: null };
}

/**
 * The batch card at a detail level.
 *
 * - Quiet: one grey line, `head`, and no rows.
 * - Normal: the head with the batch's number, and a row for each helper with what ran, its number and its state.
 * - Verbose: the same, and each row also says its model and why it was picked.
 */
export function batchCard(batch: HelperBatch, detail: Detail, length: WaitLength = "web"): BatchCard {
  const right = batchRight(batch, length);
  const head = batchHead(batch.helpers);
  if (detail === "quiet") return { detail, head, total: null, rows: [], right: right.text, tone: right.tone };
  const rows: CardRow[] = batch.helpers.map((helper) => ({
    name: nameOf(helper),
    ran: helperCounts(helper.steps),
    model: detail === "verbose" ? modelLine(helper) : "",
    number: helperNumber(helper),
    right: helperRight(helper, length),
    tone: toneOf(helper.state),
    took: helper.durationMs === null ? null : formatElapsed(helper.durationMs),
  }));
  const number = batchNumber(batch.helpers);
  return { detail, head, total: number === null ? head : `${head} · ${number}`, rows, right: right.text, tone: right.tone };
}

/** What the panel's Summary view shows for one helper. Each part is null when there is nothing to say. */
export type HelperSummary = {
  /** What the lead asked it. */
  brief: string | null;
  /** `read 13 files, 1 failed`. */
  calls: string | null;
  /** The helper's newest sentence, while it runs. */
  latest: string | null;
  /** The question it asks you, while it waits for you. */
  question: string | null;
  /** Its answer, when it is done. */
  answer: string | null;
  /** What the view leaves out: `3 thoughts · 11 old results cleared`. */
  hidden: string | null;
};

/** `1 failed`, from the helper's tool calls that failed or did not succeed. */
function failedCount(tools: readonly ToolBlock[]): number {
  return tools.filter((tool) => tool.status === "failed" || tool.unsuccessful === true).length;
}

/** The last sentence of a text, with its end mark, or the whole text when it has no mark. */
export function lastSentence(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  // A mark ends a sentence only before a space, so `auth/session.py:88` stays whole.
  const sentences = flat.split(/(?<=[.!?])\s+/);
  const last = sentences[sentences.length - 1]?.trim() ?? "";
  return last === "" ? null : last;
}

/** The count in `golem cleared 11 old tool results`, from the notice `contextChangedNote` writes. */
function clearedIn(notices: ChatState["notices"]): number {
  let total = 0;
  for (const notice of notices) {
    if (notice.action !== "cleared") continue;
    total += Number(/^golem cleared (\d+) /.exec(notice.text)?.[1] ?? 0);
  }
  return total;
}

/**
 * The Summary of a helper from its own reduced log (`reduceChat` over the helper session's events):
 * the brief, the calls in one line, its newest sentence while it runs, its question if it asks one,
 * its answer when done, and what is hidden. A helper that asks about a paid model asks in `consent.why`.
 */
export function helperSummary(chat: ChatState): HelperSummary {
  const user = chat.messages.find((message) => message.role === "user");
  const replies = chat.messages.filter((message) => message.role === "assistant");
  const tools = replies.flatMap((message) => message.tools ?? []);
  const counts = helperCounts(tools);
  const failed = failedCount(tools);
  const calls = counts === "" ? null : failed > 0 ? `${counts}, ${String(failed)} failed` : counts;

  const lastReply = [...replies].reverse().find((message) => message.text.trim() !== "");
  const brief = user?.text.trim() ?? "";
  const asking = chat.approval !== null || chat.consent !== null;
  const question = chat.approval !== null ? approvalSentence(chat.approval) : (chat.consent?.why ?? null);
  const running = chat.busy;
  const latest = running && !asking && lastReply !== undefined ? lastSentence(lastReply.text) : null;
  const answer = !running && !asking && lastReply !== undefined ? lastReply.text.trim() : null;

  const thoughts = replies.filter((message) => (message.thinking ?? "").trim() !== "").length;
  const cleared = clearedIn(chat.notices);
  const hidden = [
    thoughts === 0 ? null : `${String(thoughts)} ${thoughts === 1 ? "thought" : "thoughts"}`,
    cleared === 0 ? null : `${String(cleared)} old ${cleared === 1 ? "result" : "results"} cleared`,
  ].filter((part): part is string => part !== null);

  return {
    brief: brief === "" ? null : brief,
    calls,
    latest,
    question,
    answer: answer === "" ? null : answer,
    hidden: hidden.length === 0 ? null : hidden.join(" · "),
  };
}

/** A helper's state from the lead's log and its own: it asks, runs, is done, or stopped. */
export function helperPanelState(ref: Pick<HelperRef, "ended">, chat: ChatState): HelperState {
  if (ref.ended !== null) return endState(ref.ended.stopped);
  if (chat.approval !== null || chat.consent !== null) return "waiting";
  return chat.busy || chat.messages.length === 0 ? "running" : "done";
}

/** How long a helper worked: what its end says, or the time since it started. Null when the start time is not a date. */
export function helperWorkingMs(ref: Pick<HelperRef, "ended" | "startedAt">, nowMs: number): number | null {
  if (ref.ended !== null) return ref.ended.workingMs;
  const startedMs = Date.parse(ref.startedAt);
  return Number.isNaN(startedMs) ? null : Math.max(0, nowMs - startedMs);
}

/**
 * The limits line of the panel: `3 calls · 1m 11s · $0.50 · 14K to 0.6K`. Calls come from the helper's own
 * log until the lead's log says how it ended; the time is what it spent working, not waiting. A local model
 * costs nothing, so with `local` true the cost is left out. `nowMs` is the clock, for a helper still running.
 */
export function helperLimits(ref: Pick<HelperRef, "ended" | "startedAt">, chat: ChatState, nowMs: number, local: boolean | null = null): string {
  const ended = ref.ended;
  const calls = ended === null ? Object.keys(chat.calls).length : ended.modelCalls;
  const time = helperWorkingMs(ref, nowMs);
  const live = Object.values(chat.calls).reduce<number | null>((sum, call) => (call.costUsd === null ? sum : (sum ?? 0) + call.costUsd), null);
  const cost = ended === null ? live : ended.costUsd;
  const window = ended === null ? null : windowSaved(ended.tokens, ended.answerTokens);
  const parts = [
    `${String(calls)} ${calls === 1 ? "call" : "calls"}`,
    time === null ? null : formatElapsed(time),
    local === true || cost === null ? null : formatCost(cost),
    window,
  ];
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

/** What a helper waits to do: the tool and its target, such as `wants to use write_file: src/a.py`. */
function approvalSentence(approval: NonNullable<ChatState["approval"]>): string {
  const args = approval.args;
  const target = [args.path, args.command, args.pattern, args.query, args.ref].find((value) => typeof value === "string" && value !== "");
  return typeof target === "string" ? `wants to use ${approval.name}: ${target}` : `wants to use ${approval.name}`;
}
