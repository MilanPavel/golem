import type { ChatEvent, SkillCall } from "@golem/client";

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
  /** Why it failed, from `tool.failed`. */
  error?: string;
  /** The newest output of a running call, from `tool.output`. */
  output?: string;
};

/** Characters of live output kept per tool call. */
export const LIVE_OUTPUT_CHARS = 4_000;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
  /** The run stopped before the model finished this reply. */
  interrupted?: boolean;
  /** Event time. Completed messages use `message.completed`; a streaming reply uses `message.started`. */
  at?: string;
  /** Milliseconds from `run.started` to this finished answer. */
  durationMs?: number;
  /** Tool calls this reply asked for, in order. */
  tools?: ToolBlock[];
  /** Set on a user message that ran a skill. `text` is then the filled-in body. */
  skill?: SkillCall;
};

export type ChatState = {
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  notice: string | null;
  runStartedAt: string | null;
  /** The run in progress, for Ctrl-C. */
  runId: string | null;
  /** Set while the run waits for an answer about a tool call. */
  approval: PendingApproval | null;
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
};

export const emptyChat: ChatState = {
  messages: [],
  busy: false,
  error: null,
  notice: null,
  runStartedAt: null,
  runId: null,
  approval: null,
  todos: [],
  activeSkills: [],
  skippedSkills: [],
  down: null,
  retry: null,
};

/** What to do after a model server did not answer, besides fixing it. */
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
  if (data.code != null) {
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

export function reduceChat(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      return state;
    case "model.selected":
      return { ...state, down: null, retry: null };
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
          },
        ],
      };
    case "message.delta":
      return appendDelta(state, event.data.message_id, event.data.text);
    case "message.completed":
      return { ...state, messages: upsertCompleted(state.messages, event, state.runStartedAt) };
    case "run.started":
      return { ...state, busy: true, error: null, retry: null, runStartedAt: event.ts, runId: event.run_id };
    case "run.completed":
      return { ...state, busy: false, runStartedAt: null, runId: null, approval: null, down: null, retry: null };
    case "run.failed":
      return {
        ...state,
        busy: false,
        error: failureText(event.data),
        down: event.data.code != null ? (event.data.provider ?? "model") : state.down,
        retry: retryFor(state.messages, event.data),
        runStartedAt: null,
        runId: null,
        approval: null,
      };
    case "run.cancelled":
      return {
        ...state,
        busy: false,
        runStartedAt: null,
        runId: null,
        approval: null,
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
            ? { ...message, tools: [...(message.tools ?? []).filter((tool) => tool.callId !== block.callId), block] }
            : message,
        ),
      };
    }
    case "approval.needed": {
      const waiting = updateTool(state, event.data.call_id, (tool) => ({ ...tool, status: "waiting" }));
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
    case "approval.resolved": {
      const edited = event.data.args ?? null;
      const answered = updateTool(state, event.data.call_id, (tool) => {
        const args = edited === null ? tool.args : edited;
        return tool.status === "waiting" ? { ...tool, status: "requested", args } : { ...tool, args };
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
      return updateTool(state, event.data.call_id, (tool) => ({ ...tool, status: "running" }));
    case "tool.output":
      return updateTool(state, event.data.call_id, (tool) => ({
        ...tool,
        output: ((tool.output ?? "") + event.data.text).slice(-LIVE_OUTPUT_CHARS),
      }));
    case "tool.completed":
      return updateTool(state, event.data.call_id, (tool) => ({
        ...tool,
        status: "done",
        summary: event.data.summary,
        preview: event.data.preview,
        truncated: event.data.truncated === true,
        ...(event.data.artifact_id == null ? {} : { artifactId: event.data.artifact_id }),
      }));
    case "tool.failed":
      return updateTool(state, event.data.call_id, (tool) => ({
        ...tool,
        status: "failed",
        error: event.data.message,
      }));
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

function upsertCompleted(
  messages: readonly ChatMessage[],
  event: ChatEvent,
  runStartedAt: string | null,
): ChatMessage[] {
  if (event.type !== "message.completed") {
    return [...messages];
  }
  const durationMs = event.data.role === "assistant" ? answerDuration(runStartedAt, event.ts) : undefined;
  const next: ChatMessage = {
    id: event.data.message_id,
    role: event.data.role,
    text: event.data.text,
    streaming: false,
    interrupted: event.data.interrupted === true,
    at: event.ts,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(event.data.skill == null ? {} : { skill: event.data.skill }),
  };
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) {
    return [...messages, next];
  }
  return messages.map((message, position) =>
    position === index ? (message.tools === undefined ? next : { ...next, tools: message.tools }) : message,
  );
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
