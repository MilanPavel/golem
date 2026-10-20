import type { ChatEvent } from "@golem/client";

export type ToolStatus = "requested" | "waiting" | "running" | "done" | "failed";

/** The tool call the run waits on, from `approval.needed`. */
export type PendingApproval = {
  callId: string;
  name: string;
  args: Readonly<Record<string, unknown>>;
  /** The rule that asked, such as `built-in default`. */
  source: string;
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
};

export const emptyChat: ChatState = {
  messages: [],
  busy: false,
  error: null,
  notice: null,
  runStartedAt: null,
  runId: null,
  approval: null,
};

export const CANCELLED_NOTICE = "cancelled";
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

export function reduceChat(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      return state;
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
      return { ...state, busy: true, error: null, runStartedAt: event.ts, runId: event.run_id };
    case "run.completed":
      return { ...state, busy: false, runStartedAt: null, runId: null, approval: null };
    case "run.failed":
      return {
        ...state,
        busy: false,
        error: event.data.message,
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
        notice: event.data.reason === "user" ? CANCELLED_NOTICE : SHUTDOWN_NOTICE,
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
        },
      };
    }
    case "approval.resolved": {
      const answered = updateTool(state, event.data.call_id, (tool) =>
        tool.status === "waiting" ? { ...tool, status: "requested" } : tool,
      );
      return { ...answered, approval: null };
    }
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
