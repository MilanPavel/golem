import type { ApprovalChoice, ChatEvent, ConsentChoice, SkillCall } from "@golem/client";

import { noChecks, reduceChecks, type ChecksState } from "./checks.ts";
import { emptyPlan, reducePlan, type PlanState } from "./plan.ts";
import { contextChangedNote, emptyLiveContext, foldLiveContext, type ContextChangeData, type LiveContextState } from "./context.ts";
import { emptyRoute, foldRoute, type RouteState } from "./route.ts";
import { replyWasCut } from "./stop.ts";
import type { ToolSource } from "./sources.ts";
import type { WaitReason, WaitScope, WaitState } from "./wait.ts";
import type { TodoItem } from "./todos.ts";

export type ToolStatus = "requested" | "waiting" | "running" | "done" | "failed";

/** The tool call the run waits on, from `approval.needed`. */
export type PendingApproval = {
  callId: string;
  name: string;
  args: Readonly<Record<string, unknown>>;
  /** The rule that asked, such as `built-in default`. */
  source: string;
  /** The change a file tool would make, as a unified diff. */
  diff: string | null;
};

/** The caps of `[budget]` and what is spent, for the line under the paid question. A cap not set is null. */
export type ConsentCaps = {
  sessionUsd: number | null;
  dailyUsd: number | null;
  spentSession: number;
  spentToday: number;
};

/** The paid step-up question the run waits on, from `route.consent.needed`. */
export type PendingConsent = {
  runId: string;
  modelProfile: string;
  model: string | null;
  tier: "local" | "budget" | "frontier";
  /** One plain sentence on why golem asks. */
  why: string;
  /** golem's estimate for this turn in USD. Null when the price is unknown. */
  estimatedUsd: number | null;
  /** The answers the question offers. A spent cap leaves out `session`. */
  alternatives: readonly ConsentChoice[];
  caps: ConsentCaps | null;
  /** The struggle that made the run ask in its middle. Null for the question before a turn. */
  signal: string | null;
};

/** How a question about a tool call was answered. */
export type ApprovalAnswer = { decision: ApprovalChoice; rule: string | null; edited: boolean };

/** The question asked about a tool call, and the answer once there is one. */
export type ToolApproval = { source: string; subject: string | null; answer?: ApprovalAnswer };

/** One tool call, drawn under the assistant message that asked for it. */
export type ToolBlock = {
  callId: string;
  name: string;
  args: Readonly<Record<string, unknown>>;
  status: ToolStatus;
  /** One short line from `tool.completed`, such as `42 lines`. */
  summary?: string;
  /** The start of the output, from `tool.completed`. */
  preview?: string;
  truncated?: boolean;
  /** Where the whole output is, when it was too long for the model. */
  artifactId?: string;
  /** The call ran but did not succeed, such as a command that exited non-zero, from `tool.completed`. */
  unsuccessful?: boolean;
  /** Why it failed, from `tool.failed`. */
  error?: string;
  /** The newest output of a running call, from `tool.output`. */
  output?: string;
  /** The web pages a `web_search` or `web_fetch` call found or read, from `tool.completed`. */
  sources?: ToolSource[];
  /** When `sources` arrived: the time of `tool.completed`. */
  sourcesAt?: string;
  /** The change a file tool would make, as a unified diff, from `approval.needed`. */
  diff?: string;
  /** The question the run asked about this call, from `approval.needed` and `approval.resolved`. */
  approval?: ToolApproval;
  /** What the helper of a `delegate` call did, from the events that name this call as `parent_call_id`. */
  child?: HelperRun;
};

/**
 * A helper's work, folded under the `delegate` call that started it. Its model calls and tool
 * calls are not messages: its text is the tool's result. `tokens` and `costUsd` are the sums of its
 * finished model calls, and `answerTokens` is the output of its last one.
 */
export type HelperRun = {
  model: string | null;
  modelCalls: number;
  toolSteps: ToolBlock[];
  tokens: number | null;
  costUsd: number | null;
  status: "running" | "done" | "failed";
  answerTokens: number | null;
  /** Time of its first event. */
  startedAt: string | null;
  /** From `tool.completed` of the `delegate` call, or the time between its first and last event. */
  durationMs: number | null;
};

const emptyHelper: HelperRun = {
  model: null,
  modelCalls: 0,
  toolSteps: [],
  tokens: null,
  costUsd: null,
  status: "running",
  answerTokens: null,
  startedAt: null,
  durationMs: null,
};

/** Characters of live output kept per tool call. */
export const LIVE_OUTPUT_CHARS = 4_000;

/** How far the model got writing a `write_file` or `edit_file` call. `path` is null until it is whole. */
export type WritingBlock = { name: string; path: string | null; lines: number; chars: number };

/** What one model call that wrote a reply used, from `model.call.started` and `model.call.completed`. */
export type MessageCall = {
  model: string | null;
  tier: "local" | "budget" | "frontier" | null;
  /** Input plus output tokens. Null until the call completes, or when it reported none. */
  tokens: number | null;
  /** golem's estimate of the cost. Null when the price is not known. */
  costUsd: number | null;
  /** The call has ended. */
  done: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
  /** The run stopped before the model finished this reply. */
  interrupted?: boolean;
  /** Event time. Completed messages use `message.completed`; a streaming reply uses `message.started`. */
  at?: string;
  /** The run the message belongs to, from `message.completed`. A user message holds the request that started it,
   * and a reply's run finds the changes of its turn. */
  runId?: string;
  /** Milliseconds from `run.started` to this finished answer. */
  durationMs?: number;
  /** What the model thought before it answered, from `message.thinking.delta` and `message.completed`. */
  thinking?: string;
  /** Milliseconds the model thought, from `message.completed`. */
  thinkingMs?: number;
  /** The model stopped at the length limit and the reply asked for no tool, from `model.call.completed`. */
  cut?: boolean;
  /** The model call that wrote this reply. */
  call?: MessageCall;
  /** Tool calls this reply asked for, in order. */
  tools?: ToolBlock[];
  /** A file the model is still writing, from `tool.writing`. Gone once the call is requested or the reply completes. */
  writing?: WritingBlock | null;
  /** Set on a user message that ran a skill. `text` is then the filled-in body. */
  skill?: SkillCall;
};

/**
 * One quiet line in the transcript for a change golem made to what it sends: old tool results
 * cleared, old turns summarised, or the window grown. It is not a message: the model never sees
 * it and an export does not hold it. `afterId` is the message the line follows, null at the top.
 */
export type ChatNotice = {
  id: string;
  afterId: string | null;
  action: ContextChangeData["action"];
  text: string;
  at: string;
};

/** The notices that follow message `id`, or the ones at the top for null. In Quiet, a clear is hidden. */
export function noticesAfter(notices: readonly ChatNotice[], id: string | null, quiet = false): ChatNotice[] {
  return notices.filter((notice) => notice.afterId === id && !(quiet && notice.action === "cleared"));
}

export type ChatState = {
  messages: ChatMessage[];
  /** What golem did to keep the context small, each placed after the message it followed. */
  notices: ChatNotice[];
  /** Tool results cleared since the last run began, for the composer chip. 0 when none. */
  clearedNow: number;
  busy: boolean;
  error: string | null;
  notice: string | null;
  runStartedAt: string | null;
  /** The run in progress, for Ctrl-C. */
  runId: string | null;
  /** Set while the run waits for an answer about a tool call. */
  approval: PendingApproval | null;
  /** Set while the run waits for an answer about a paid model. */
  consent: PendingConsent | null;
  /** The agent's todo list, from the newest `todos.updated`. */
  todos: TodoItem[];
  /** The skills pinned in the session, in pin order, from `skill.activated` and `skill.deactivated`. */
  activeSkills: string[];
  /** Pinned skills the newest model call left out, from `skill.skipped`, until one reads them again. */
  skippedSkills: string[];
  /**
   * The provider whose server did not answer, from `run.failed` with
   * `model_unreachable` or `not_installed`. Cleared when a run completes or
   * the model changes.
   */
  down: string | null;
  /**
   * The message a missing Ollama stopped, from `run.failed` with
   * `not_installed`. The banner offers to install Ollama and send it again.
   */
  retry: { text: string; provider: string } | null;
  /** True while a chat call waits for its turn on a local model, from `model.waiting`. */
  localWait: boolean;
  /** What a call loads while the model reloads with a larger window, from `model.waiting`. */
  loading: { model: string; window: number } | null;
  /** Why the call waits, from the `reason` and the fields after it in `model.waiting`. Null from a daemon that sends no `reason`. */
  wait: WaitState | null;
  /** True after a model call wrote a tool call as text that golem could not read, until the next run starts. */
  unreadCall: boolean;
  /** The context of the newest model call that reported its input, from the `model.call.*` events. */
  context: LiveContextState;
  /** The model calls seen so far, by the id of the reply each one wrote. */
  calls: Readonly<Record<string, MessageCall>>;
  /** The session's option overrides, from the newest `model.options.changed`: the whole set. */
  options: Readonly<Record<string, number | string>>;
  /** The session's permission mode override, from the newest `session.mode.changed`. Null follows config.toml. */
  permissionMode: "careful" | "balanced" | "autopilot" | null;
  /** Whether the session is in plan first, and its newest plan, from `session.plan.changed` and `plan.proposed`. */
  plan: PlanState;
  /** The project's checks per run, the question about running them, and the answer, from the `check.*` events. */
  checks: ChecksState;
  /** The session's route mode and the pick of each run, from `session.updated` and `model.routed`. */
  route: RouteState;
};

export const emptyChat: ChatState = {
  messages: [],
  notices: [],
  clearedNow: 0,
  busy: false,
  error: null,
  notice: null,
  runStartedAt: null,
  runId: null,
  approval: null,
  consent: null,
  todos: [],
  activeSkills: [],
  skippedSkills: [],
  down: null,
  retry: null,
  localWait: false,
  loading: null,
  wait: null,
  unreadCall: false,
  context: emptyLiveContext,
  calls: {},
  options: {},
  permissionMode: null,
  plan: emptyPlan,
  checks: noChecks,
  route: emptyRoute,
};

/** What to do after a model server did not answer, besides fixing it. */
export { WAITING_FOR_LOCAL_MODEL } from "./wait.ts";

export const SWITCH_HINT = "/model to switch";
/** The picker installs a missing Ollama, so that beats the daemon's brew hint. */
export const INSTALL_HINT = "/model to install it or switch";

/** The banner while `retry` waits: the picker's install question, and the way out. */
export const RETRY_QUESTION =
  "Ollama is not installed. Install it with Homebrew and send your message again? Enter installs · Esc dismisses · /model to switch";

/**
 * The chat once `provider`'s server answers again: it is no longer marked
 * down, and the question about installing it goes away.
 */
export function serverUp(state: ChatState, provider: string): ChatState {
  const down = state.down === provider ? null : state.down;
  const retry = state.retry?.provider === provider ? null : state.retry;
  return down === state.down && retry === state.retry ? state : { ...state, down, retry };
}

/** The chat after a model listing: each provider the listing calls ready is up. */
export function providersUp(state: ChatState, providers: readonly { provider: string; status: string }[]): ChatState {
  return providers.reduce((next, entry) => (entry.status === "ready" ? serverUp(next, entry.provider) : next), state);
}

type RunFailure = Extract<ChatEvent, { type: "run.failed" }>["data"];

/** The banner for a failed run: the message, then how to fix it. */
export function failureText(data: RunFailure): string {
  if (data.code === "not_installed") {
    return `${data.message} · ${INSTALL_HINT}`;
  }
  const parts = [data.message];
  if (data.hint != null) {
    parts.push(data.hint);
  }
  if (data.code != null && data.code !== "budget_spent" && data.code !== "local_only") {
    parts.push(SWITCH_HINT);
  }
  return parts.join(" · ");
}

export const CANCELLED_NOTICE = "cancelled";

/** The chat once a download ends: its progress leaves the banner. */
export function downloadEnded(state: ChatState): ChatState {
  return state.notice?.startsWith("downloading ") === true ? { ...state, notice: null } : state;
}
/** What the banner says when a model call leaves a pinned skill out. */
export function skippedNotice(name: string, why: string): string {
  return `${why}, so ${name} is left out. It stays pinned: fix it, or /skill unpin ${name}`;
}

/** Forget that ``name`` was left out, and its notice, once it is read again or unpinned. */
function withoutSkip(state: ChatState, name: string): ChatState {
  if (!state.skippedSkills.includes(name)) {
    return state;
  }
  const stale = state.notice?.endsWith(`/skill unpin ${name}`) === true;
  return {
    ...state,
    skippedSkills: state.skippedSkills.filter((n) => n !== name),
    notice: stale ? null : state.notice,
  };
}

/** Where the notice for a tool call written as text points to the tuning options. */
export type UnreadCallClient = "tui" | "web";

/** What to tell the person when a model wrote a tool call as text and golem could not read it. */
export function unreadCallNotice(client: UnreadCallClient): string {
  const tune = client === "tui" ? "/tune" : "the Tune tab";
  return `The model wrote a tool call as text, and golem couldn't read it. Ask again, or try ${tune} → precise (a lower temperature makes this rarer).`;
}

export const SHUTDOWN_NOTICE = "the daemon stopped, so the run was cancelled";

/**
 * The newest message `/fork` can cut at: finished, and not an interrupted
 * reply with no text, which the checkpoint never stored.
 */
export function forkPoint(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && !message.streaming && !(message.interrupted === true && message.text === "")) {
      return message.id;
    }
  }
  return null;
}

/** The newest user message, when a missing Ollama stopped it. */
function retryFor(messages: readonly ChatMessage[], data: RunFailure): ChatState["retry"] {
  if (data.code !== "not_installed") {
    return null;
  }
  const sent = [...messages].reverse().find((message) => message.role === "user");
  return sent === undefined || sent.text.trim() === "" ? null : { text: sent.text, provider: data.provider ?? "ollama" };
}

/** The `delegate` call an event of a child run names, or null for the run's own events. */
function parentCallOf(event: ChatEvent): string | null {
  const data: object = event.data;
  return "parent_call_id" in data && typeof data.parent_call_id === "string" ? data.parent_call_id : null;
}

type HelperEvent = Extract<ChatEvent, { type: "helper.started" | "helper.step" | "helper.state" | "helper.ended" }>;

/** The events a helper session sends to its lead's log, each naming the `delegate` call as `call_id`. `helper.wait` is the lead's own. */
function isHelperEvent(event: ChatEvent): event is HelperEvent {
  return (
    event.type === "helper.started" || event.type === "helper.step" || event.type === "helper.state" || event.type === "helper.ended"
  );
}

/** A tool call after one of the events of its life: started, output, completed or failed. */
function foldTool(tool: ToolBlock, event: ChatEvent): ToolBlock {
  switch (event.type) {
    case "tool.started":
      return { ...tool, status: "running" };
    case "tool.output":
      return { ...tool, output: ((tool.output ?? "") + event.data.text).slice(-LIVE_OUTPUT_CHARS) };
    case "tool.completed":
      return {
        ...withoutOutput(tool),
        status: "done",
        summary: event.data.summary,
        preview: event.data.preview,
        truncated: event.data.truncated === true,
        ...(event.data.artifact_id == null ? {} : { artifactId: event.data.artifact_id }),
        ...(event.data.failed === true ? { unsuccessful: true } : {}),
        ...(event.data.diff ? { diff: event.data.diff } : {}),
        ...(event.data.sources?.length ? { sources: event.data.sources, sourcesAt: event.ts } : {}),
      };
    case "tool.failed":
      return { ...withoutOutput(tool), status: "failed", error: event.data.message };
    default:
      return tool;
  }
}

/** The live output goes once the call ends: it is not in the log, so a replay would not have it. */
function withoutOutput(tool: ToolBlock): ToolBlock {
  const rest = { ...tool };
  delete rest.output;
  return rest;
}

function elapsed(from: string | null, to: string): number | null {
  if (from === null) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isNaN(ms) || ms < 0 ? null : ms;
}

/** The helper after one of its own events: a model call, or a step of one of its tools. */
function foldHelper(child: HelperRun, event: ChatEvent): HelperRun {
  const next = { ...child, startedAt: child.startedAt ?? event.ts };
  switch (event.type) {
    case "model.call.started":
      return { ...next, modelCalls: child.modelCalls + 1, model: event.data.model ?? child.model };
    case "model.call.completed": {
      const usage = event.data.usage;
      const counted = typeof usage?.input === "number" || typeof usage?.output === "number";
      return {
        ...next,
        tokens: counted ? (child.tokens ?? 0) + (usage?.input ?? 0) + (usage?.output ?? 0) : child.tokens,
        costUsd: event.data.cost_usd == null ? child.costUsd : (child.costUsd ?? 0) + event.data.cost_usd,
        answerTokens: counted ? (usage?.output ?? 0) : child.answerTokens,
      };
    }
    case "tool.requested": {
      const block: ToolBlock = {
        callId: event.data.call_id,
        name: event.data.name,
        args: event.data.args,
        status: "requested",
      };
      return { ...next, toolSteps: [...child.toolSteps.filter((tool) => tool.callId !== block.callId), block] };
    }
    case "helper.started":
      return { ...next, model: event.data.model };
    case "helper.step": {
      const { step_id: callId, name, status } = event.data;
      const args = event.data.args ?? {};
      const summary = event.data.summary == null ? {} : { summary: event.data.summary };
      const known = child.toolSteps.some((tool) => tool.callId === callId);
      const toolSteps = known
        ? child.toolSteps.map((tool) => (tool.callId === callId ? { ...tool, status, ...summary } : tool))
        : [...child.toolSteps, { callId, name, args, status, ...summary }];
      return { ...next, toolSteps };
    }
    case "helper.ended":
      return {
        ...next,
        modelCalls: event.data.model_calls,
        tokens: event.data.tokens,
        costUsd: event.data.cost_usd,
        answerTokens: event.data.answer_tokens,
        status: event.data.stopped === "failed" ? "failed" : "done",
        durationMs: event.data.duration_ms,
      };
    case "tool.started":
    case "tool.output":
    case "tool.completed":
    case "tool.failed": {
      const callId = event.data.call_id;
      return { ...next, toolSteps: child.toolSteps.map((tool) => (tool.callId === callId ? foldTool(tool, event) : tool)) };
    }
    default:
      return next;
  }
}

/** The chat after an event of a child run: folded into the `delegate` step it belongs to. Nothing else sees it. */
function reduceChild(state: ChatState, parentCallId: string, event: ChatEvent): ChatState {
  return updateTool(state, parentCallId, (tool) => ({ ...tool, child: foldHelper(tool.child ?? emptyHelper, event) }));
}

/** A `delegate` call that ended: its helper is done or failed, and took as long as the call did. */
function endHelper(tool: ToolBlock, event: ChatEvent): ToolBlock {
  if (tool.name !== "delegate" || (event.type !== "tool.completed" && event.type !== "tool.failed")) return tool;
  const child = tool.child ?? emptyHelper;
  const own = event.data.duration_ms ?? null;
  return {
    ...tool,
    child: {
      ...child,
      status: event.type === "tool.failed" ? "failed" : "done",
      durationMs: own ?? child.durationMs ?? elapsed(child.startedAt, event.ts),
    },
  };
}

export function reduceChat(state: ChatState, event: ChatEvent): ChatState {
  const parent = parentCallOf(event);
  if (parent !== null) return reduceChild(state, parent, event);
  if (isHelperEvent(event)) return reduceChild(state, event.data.call_id, event);
  const base = reduceChatEvent(state, event);
  const plan = reducePlan(state.plan, event);
  const next = plan === state.plan ? base : { ...base, plan };
  const context = foldLiveContext(state.context, event);
  const checks = reduceChecks(next.checks, event);
  const route = foldRoute(next.route, event);
  if (context === next.context && checks === next.checks && route === next.route) return next;
  return { ...next, context, checks, route };
}

function reduceChatEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      return state;
    case "model.selected":
      return { ...state, down: null, retry: null };
    case "model.options.changed":
      return { ...state, options: event.data.options };
    case "session.mode.changed":
      return { ...state, permissionMode: event.data.mode };
    case "model.call.started": {
      const call: MessageCall = {
        model: event.data.model ?? null,
        tier: event.data.tier ?? null,
        tokens: null,
        costUsd: null,
        done: false,
      };
      return withCall(state, event.data.message_id, call);
    }
    case "message.started":
      return {
        ...state,
        error: null,
        messages: [
          ...state.messages,
          {
            id: event.data.message_id,
            role: "assistant",
            text: "",
            streaming: true,
            at: event.ts,
            ...(event.run_id == null ? {} : { runId: event.run_id }),
            ...callOf(state, event.data.message_id),
          },
        ],
      };
    case "message.delta":
      return appendDelta(notWaiting(state), event.data.message_id, event.data.text);
    case "message.thinking.delta":
      return appendThinking(notWaiting(state), event.data.message_id, event.data.text);
    case "model.waiting": {
      const { waiting, model, window } = event.data;
      const loading = waiting && model != null && window != null ? { model, window } : null;
      const wait = waiting ? waitOf(event.data) : null;
      if (
        waiting === state.localWait &&
        loading?.model === state.loading?.model &&
        loading?.window === state.loading?.window &&
        sameWait(wait, state.wait)
      ) {
        return state;
      }
      return { ...state, localWait: waiting, loading, wait };
    }
    case "message.completed":
      return { ...notWaiting(state), messages: upsertCompleted(state.messages, event, state.runStartedAt, state.calls) };
    case "context.changed": {
      const notice: ChatNotice = {
        id: `context-${event.seq}`,
        afterId: state.messages[state.messages.length - 1]?.id ?? null,
        action: event.data.action,
        text: contextChangedNote(event.data),
        at: event.ts,
      };
      const cleared = event.data.action === "cleared" ? state.clearedNow + (event.data.count ?? 0) : state.clearedNow;
      return { ...state, notices: [...state.notices, notice], clearedNow: cleared };
    }
    case "run.started":
      return {
        ...state,
        clearedNow: 0,
        busy: true,
        error: null,
        retry: null,
        unreadCall: false,
        runStartedAt: event.ts,
        runId: event.run_id,
      };
    case "model.call.completed": {
      const usage = event.data.usage;
      const counted = typeof usage?.input === "number" || typeof usage?.output === "number";
      const before = state.calls[event.data.message_id];
      const call: MessageCall = {
        model: before?.model ?? null,
        tier: before?.tier ?? null,
        tokens: counted ? (usage?.input ?? 0) + (usage?.output ?? 0) : null,
        costUsd: event.data.cost_usd ?? null,
        done: true,
      };
      const noted = withCall(state, event.data.message_id, call);
      const next = event.data.text_tool_calls === "unread" ? { ...noted, unreadCall: true } : noted;
      if (!replyWasCut(event.data.stop_reason)) {
        return next;
      }
      // The tool requests of a reply come after its `model.call.completed`; `tool.requested` clears this.
      return {
        ...next,
        messages: next.messages.map((message) =>
          message.id === event.data.message_id && message.tools === undefined ? { ...message, cut: true } : message,
        ),
      };
    }
    case "run.completed":
      return { ...notWaiting(stopWriting(state)), busy: false, runStartedAt: null, runId: null, approval: null, consent: null, down: null, retry: null };
    case "run.failed":
      return {
        ...notWaiting(stopWriting(state)),
        busy: false,
        error: failureText(event.data),
        down: event.data.code != null && event.data.code !== "budget_spent" && event.data.code !== "local_only" ? (event.data.provider ?? "model") : state.down,
        retry: retryFor(state.messages, event.data),
        runStartedAt: null,
        runId: null,
        approval: null,
        consent: null,
      };
    case "run.cancelled":
      return {
        ...notWaiting(stopWriting(state)),
        busy: false,
        runStartedAt: null,
        runId: null,
        approval: null,
        consent: null,
        // A cancel you asked for shows as a hint. One from a daemon shutdown stays in the banner.
        notice: event.data.reason === "user" ? state.notice : SHUTDOWN_NOTICE,
      };
    case "tool.requested": {
      const block: ToolBlock = {
        callId: event.data.call_id,
        name: event.data.name,
        args: event.data.args,
        status: "requested",
      };
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === event.data.message_id
            ? {
                ...withoutWriting(withoutCut(message)),
                tools: [...(message.tools ?? []).filter((tool) => tool.callId !== block.callId), block],
              }
            : message,
        ),
      };
    }
    case "tool.writing":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === event.data.message_id
            ? {
                ...message,
                writing: {
                  name: event.data.name,
                  path: event.data.path ?? null,
                  lines: event.data.lines,
                  chars: event.data.chars,
                },
              }
            : message,
        ),
      };
    case "approval.needed": {
      const waiting = updateTool(state, event.data.call_id, (tool) => ({
        ...tool,
        status: "waiting",
        approval: { source: event.data.source, subject: event.data.subject ?? null },
        ...(event.data.diff ? { diff: event.data.diff } : {}),
      }));
      return {
        ...waiting,
        busy: true,
        runId: event.run_id,
        approval: {
          callId: event.data.call_id,
          name: event.data.name,
          args: event.data.args,
          source: event.data.source,
          diff: event.data.diff ?? null,
        },
      };
    }
    case "route.consent.needed": {
      const caps = event.data.caps ?? null;
      return {
        ...state,
        busy: true,
        runId: event.run_id,
        consent: {
          runId: event.run_id,
          modelProfile: event.data.model_profile,
          model: event.data.model ?? null,
          tier: event.data.tier,
          why: event.data.why,
          estimatedUsd: event.data.estimated_usd ?? null,
          alternatives: event.data.alternatives,
          signal: event.data.signal ?? null,
          caps:
            caps === null
              ? null
              : {
                  sessionUsd: caps.session_usd ?? null,
                  dailyUsd: caps.daily_usd ?? null,
                  spentSession: caps.spent_session,
                  spentToday: caps.spent_today,
                },
        },
      };
    }
    case "route.consent.answered":
      return { ...state, consent: null };
    case "approval.resolved": {
      const edited = event.data.args ?? null;
      const answered = updateTool(state, event.data.call_id, (tool) => {
        const args = edited === null ? tool.args : edited;
        const answer: ApprovalAnswer = {
          decision: event.data.decision,
          rule: event.data.rule ?? null,
          edited: edited !== null,
        };
        const approval: ToolApproval = {
          ...(tool.approval ?? { source: "", subject: event.data.subject ?? null }),
          answer,
        };
        return tool.status === "waiting"
          ? { ...tool, status: "requested", args, approval }
          : { ...tool, args, approval };
      });
      return { ...answered, approval: null };
    }
    case "skill.activated": {
      const name = event.data.name;
      if (event.data.how !== "pinned") {
        return state;
      }
      const activeSkills = state.activeSkills.includes(name) ? state.activeSkills : [...state.activeSkills, name];
      return { ...withoutSkip(state, name), activeSkills };
    }
    case "skill.deactivated": {
      const name = event.data.name;
      return { ...withoutSkip(state, name), activeSkills: state.activeSkills.filter((n) => n !== name) };
    }
    case "skill.skipped": {
      const name = event.data.name;
      const skippedSkills = state.skippedSkills.includes(name) ? state.skippedSkills : [...state.skippedSkills, name];
      return { ...state, skippedSkills, notice: skippedNotice(name, event.data.message) };
    }
    case "todos.updated":
      return { ...state, todos: event.data.todos.map((todo) => ({ id: todo.id, text: todo.text, status: todo.status })) };
    case "tool.started":
    case "tool.output":
      return updateTool(state, event.data.call_id, (tool) => foldTool(tool, event));
    case "tool.completed":
    case "tool.failed":
      return updateTool(state, event.data.call_id, (tool) => endHelper(foldTool(tool, event), event));
    default:
      return state;
  }
}

function updateTool(state: ChatState, callId: string, change: (tool: ToolBlock) => ToolBlock): ChatState {
  let index = state.messages.length - 1;
  while (index >= 0 && state.messages[index]?.tools?.some((tool) => tool.callId === callId) !== true) {
    index -= 1;
  }
  if (index < 0) {
    return state;
  }
  return {
    ...state,
    messages: state.messages.map((message, position) =>
      position === index
        ? { ...message, tools: message.tools?.map((tool) => (tool.callId === callId ? change(tool) : tool)) }
        : message,
    ),
  };
}

export function appendDelta(state: ChatState, messageId: string, text: string): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === messageId ? { ...message, text: message.text + text } : message,
    ),
  };
}

/** Add streamed thinking text to the message `messageId`. */
export function appendThinking(state: ChatState, messageId: string, text: string): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === messageId ? { ...message, thinking: (message.thinking ?? "") + text } : message,
    ),
  };
}

/**
 * The one line shown above an answer that came after thinking: `thinking…` while the thinking
 * streams, `thought for 12s` when it is done, `thought` when its time is not known. Null when
 * the message has no thinking. Both clients show this line.
 */
export function thinkingLine(
  message: Pick<ChatMessage, "streaming" | "text" | "thinking" | "thinkingMs">,
): string | null {
  if (message.thinking === undefined || message.thinking === "") {
    return null;
  }
  if (message.streaming && message.text === "") {
    return "thinking…";
  }
  return message.thinkingMs === undefined ? "thought" : `thought for ${thoughtTime(message.thinkingMs)}`;
}

/** `<1s`, `12s`, then `1m 05s` from a minute on. */
function thoughtTime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) {
    return "<1s";
  }
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export type DeltaBatcher = {
  push(messageId: string, text: string): void;
  flush(): void;
  stop(): void;
};

export function createDeltaBatcher(
  onFlush: (messageId: string, text: string) => void,
  intervalMs = 16,
): DeltaBatcher {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setInterval> | undefined;

  function flush(): void {
    for (const [messageId, text] of pending) {
      onFlush(messageId, text);
    }
    pending.clear();
  }

  return {
    push(messageId: string, text: string): void {
      pending.set(messageId, (pending.get(messageId) ?? "") + text);
      if (timer === undefined) {
        timer = setInterval(flush, intervalMs);
      }
    },
    flush,
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      flush();
    },
  };
}

function callOf(state: Pick<ChatState, "calls">, id: string): { call?: MessageCall } {
  const call = state.calls[id];
  return call === undefined ? {} : { call };
}

/** Keep a call by its reply's id, and put it on the reply when that is already in the list. */
function withCall(state: ChatState, id: string, call: MessageCall): ChatState {
  return {
    ...state,
    calls: { ...state.calls, [id]: call },
    messages: state.messages.map((message) => (message.id === id ? { ...message, call } : message)),
  };
}

function upsertCompleted(
  messages: readonly ChatMessage[],
  event: ChatEvent,
  runStartedAt: string | null,
  calls: Readonly<Record<string, MessageCall>>,
): ChatMessage[] {
  if (event.type !== "message.completed") {
    return [...messages];
  }
  const durationMs = event.data.role === "assistant" ? answerDuration(runStartedAt, event.ts) : undefined;
  const index = messages.findIndex((message) => message.id === event.data.message_id);
  const runId = messages[index]?.runId ?? event.run_id;
  const next: ChatMessage = {
    id: event.data.message_id,
    role: event.data.role,
    text: event.data.text,
    streaming: false,
    interrupted: event.data.interrupted === true,
    at: event.ts,
    ...(runId === null || runId === undefined ? {} : { runId }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(event.data.skill == null ? {} : { skill: event.data.skill }),
    ...callOf({ calls }, event.data.message_id),
  };
  if (index < 0) {
    return [...messages, withThinking(next, event.data.thinking, event.data.thinking_ms)];
  }
  return messages.map((message, position) => {
    if (position !== index) {
      return message;
    }
    // A reply stopped by a cancel completes with no thinking, so keep what streamed.
    const kept = event.data.thinking ?? message.thinking;
    const done = withThinking(next, kept, event.data.thinking_ms);
    const final = message.cut === true ? { ...done, cut: true } : done;
    return message.tools === undefined ? final : { ...final, tools: message.tools };
  });
}

function notWaiting(state: ChatState): ChatState {
  return state.localWait || state.loading !== null || state.wait !== null
    ? { ...state, localWait: false, loading: null, wait: null }
    : state;
}

/** The wait a `model.waiting` event describes, or null from a daemon that sends no `reason`. */
function waitOf(data: {
  reason?: WaitReason | null;
  line?: string | null;
  model?: string | null;
  position?: number | null;
  holder?: string | null;
  retry_in_ms?: number | null;
  silent_ms?: number | null;
  scope?: WaitScope | null;
  will_retry?: boolean | null;
}): WaitState | null {
  if (data.reason == null) return null;
  return {
    reason: data.reason,
    line: data.line ?? null,
    model: data.model ?? null,
    position: data.position ?? null,
    holder: data.holder ?? null,
    retryInMs: data.retry_in_ms ?? null,
    silentMs: data.silent_ms ?? null,
    scope: data.scope ?? null,
    willRetry: data.will_retry ?? null,
  };
}

function sameWait(a: WaitState | null, b: WaitState | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.reason === b.reason &&
    a.line === b.line &&
    a.model === b.model &&
    a.position === b.position &&
    a.holder === b.holder &&
    a.retryInMs === b.retryInMs &&
    a.silentMs === b.silentMs &&
    a.scope === b.scope &&
    a.willRetry === b.willRetry
  );
}

function withoutWriting(message: ChatMessage): ChatMessage {
  const rest = { ...message };
  delete rest.writing;
  return rest;
}

/** Forget every file a reply was writing: the run ended, or the connection to it was lost. */
export function stopWriting(state: ChatState): ChatState {
  if (!state.messages.some((message) => message.writing != null)) {
    return state;
  }
  return { ...state, messages: state.messages.map((message) => (message.writing == null ? message : withoutWriting(message))) };
}

function withoutCut(message: ChatMessage): ChatMessage {
  const rest = { ...message };
  delete rest.cut;
  return rest;
}

function withThinking(message: ChatMessage, thinking: string | null | undefined, ms: number | null | undefined): ChatMessage {
  if (thinking == null || thinking === "") {
    return message;
  }
  return { ...message, thinking, ...(ms == null ? {} : { thinkingMs: ms }) };
}

/** Absent when either timestamp is missing or the clock went backwards. */
function answerDuration(startedAt: string | null, finishedAt: string): number | undefined {
  if (startedAt === null || startedAt.length === 0 || finishedAt.length === 0) {
    return undefined;
  }
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) {
    return undefined;
  }
  return finished - started;
}
