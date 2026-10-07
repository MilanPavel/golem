import type { ChatEvent } from "@golem/client";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
};

export type ChatState = {
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  notice: string | null;
};

export const emptyChat: ChatState = {
  messages: [],
  busy: false,
  error: null,
  notice: null,
};

export function reduceChat(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "session.created":
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
          },
        ],
      };
    case "message.delta":
      return appendDelta(state, event.data.message_id, event.data.text);
    case "message.completed":
      return { ...state, messages: upsertCompleted(state.messages, event) };
    case "run.started":
      return { ...state, busy: true, error: null };
    case "run.completed":
      return { ...state, busy: false };
    case "run.failed":
      return { ...state, busy: false, error: event.data.message };
    default:
      return state;
  }
}

export function appendDelta(state: ChatState, messageId: string, text: string): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === messageId ? { ...message, text: message.text + text } : message,
    ),
  };
}

export function connectionLost(state: ChatState): ChatState {
  return { ...state, busy: false };
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

function upsertCompleted(messages: readonly ChatMessage[], event: ChatEvent): ChatMessage[] {
  if (event.type !== "message.completed") {
    return [...messages];
  }
  const next: ChatMessage = {
    id: event.data.message_id,
    role: event.data.role,
    text: event.data.text,
    streaming: false,
  };
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) {
    return [...messages, next];
  }
  return messages.map((message, position) => (position === index ? next : message));
}
