import type { ChatEvent } from "@golem/client";
import { appendDelta, emptyChat, reduceChat, type ChatState } from "@golem/view";
import { createStore, type StoreSource } from "./create-store.ts";

export type SessionModel = { profile: string; provider: string | null; name: string | null };

export type SessionView = {
  chat: ChatState;
  title: string | null;
  cwd: string | null;
  model: SessionModel | null;
  status: "attaching" | "ready" | "gone";
};

export type SessionStore = StoreSource<SessionView> & {
  /** Fold one event. Deltas wait for the next frame, anything else applies at once. */
  dispatch(event: ChatEvent): void;
  /** Fold the waiting deltas now. */
  flush(): void;
  setStatus(status: SessionView["status"]): void;
  /** Cancel a pending frame. */
  dispose(): void;
};

/** `requestAnimationFrame` and its cancel, replaceable in a test. */
export type Frame = { request(callback: () => void): number; cancel(handle: number): void };

const browserFrame: Frame = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  },
};

export const initialSessionView: SessionView = {
  chat: emptyChat,
  title: null,
  cwd: null,
  model: null,
  status: "attaching",
};

type DevtoolsConnection = { init(state: unknown): void; send(action: string, state: unknown): void };
type DevtoolsExtension = { connect(options: { name: string }): DevtoolsConnection };

/** Dev mode only, and only with the extension installed. Plain browser API, no Redux. */
function connectDevtools(name: string | undefined): DevtoolsConnection | undefined {
  if (!import.meta.env.DEV || name === undefined || typeof window === "undefined") {
    return undefined;
  }
  const extension = (window as { __REDUX_DEVTOOLS_EXTENSION__?: DevtoolsExtension }).__REDUX_DEVTOOLS_EXTENSION__;
  if (!extension) {
    return undefined;
  }
  try {
    const connection = extension.connect({ name });
    connection.init(initialSessionView);
    return connection;
  } catch {
    return undefined;
  }
}

function fold(view: SessionView, event: ChatEvent): SessionView {
  const chat = reduceChat(view.chat, event);
  let { title, cwd, model } = view;
  if (event.type === "session.created") {
    cwd = event.data.cwd ?? null;
  }
  if (event.type === "session.created" || event.type === "model.selected") {
    model = {
      profile: event.data.model_profile,
      provider: event.data.model_provider ?? null,
      name: event.data.model_name ?? null,
    };
  }
  if (event.type === "session.updated") {
    if (typeof event.data.title === "string") {
      title = event.data.title;
    }
    if (typeof event.data.cwd === "string") {
      cwd = event.data.cwd;
    }
  }
  if (chat === view.chat && title === view.title && cwd === view.cwd && model === view.model) {
    return view;
  }
  return { ...view, chat, title, cwd, model };
}

/**
 * One session's snapshot. `message.delta` events wait in a buffer and fold once per frame. Any
 * other event folds the buffer first, then itself, at once: a hidden tab runs no frames, and the
 * approval card and the title must still be right in it.
 */
export function createSessionStore(frame: Frame = browserFrame, devtoolsName?: string): SessionStore {
  const store = createStore<SessionView>(initialSessionView);
  const pending = new Map<string, string>();
  let handle: number | undefined;
  const devtools = connectDevtools(devtoolsName);

  function cancelFrame(): void {
    if (handle !== undefined) {
      frame.cancel(handle);
      handle = undefined;
    }
  }

  function foldPending(view: SessionView): SessionView {
    if (pending.size === 0) {
      return view;
    }
    let chat = view.chat;
    for (const [messageId, text] of pending) {
      chat = appendDelta(chat, messageId, text);
    }
    pending.clear();
    return { ...view, chat };
  }

  function flush(): void {
    cancelFrame();
    if (pending.size === 0) {
      return;
    }
    store.set(foldPending(store.getSnapshot()));
    devtools?.send("message.delta", store.getSnapshot());
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispatch(event) {
      if (event.type === "message.delta") {
        pending.set(event.data.message_id, (pending.get(event.data.message_id) ?? "") + event.data.text);
        if (handle === undefined) {
          handle = frame.request(() => {
            handle = undefined;
            flush();
          });
        }
        return;
      }
      cancelFrame();
      store.set(fold(foldPending(store.getSnapshot()), event));
      devtools?.send(event.type, store.getSnapshot());
    },
    flush,
    setStatus(status) {
      const view = store.getSnapshot();
      if (view.status !== status) {
        store.set({ ...view, status });
        devtools?.send(`status ${status}`, store.getSnapshot());
      }
    },
    dispose() {
      cancelFrame();
      pending.clear();
    },
  };
}
