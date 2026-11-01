import type { ChatEvent, ConnectionState, PullUpdate, SessionSummary } from "@golem/client";
import { vi } from "vitest";
import type { PageClient } from "./page.ts";

let seq = 0;

/** A chat event with the envelope filled in. */
export function ev(sessionId: string, type: ChatEvent["type"], data: Record<string, unknown> = {}): ChatEvent {
  seq += 1;
  return { seq, session_id: sessionId, run_id: "r1", ts: "2026-11-01T10:00:00+00:00", type, data } as ChatEvent;
}

export function summary(id: string, updatedAt: string, cwd: string | null = null, lastSeq = 1): SessionSummary {
  return {
    session_id: id,
    created_at: updatedAt,
    updated_at: updatedAt,
    last_seq: lastSeq,
    model_profile: "default",
    status: "idle",
    cwd,
    title: null,
  };
}

function listeners<A>() {
  const set = new Set<(arg: A) => void>();
  return {
    on(listener: (arg: A) => void) {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    emit(arg: A) {
      for (const listener of [...set]) listener(arg);
    },
    size: () => set.size,
  };
}

/** A client that records calls and lets a test push events. */
export function fakeClient() {
  const state = listeners<ConnectionState>();
  const event = listeners<ChatEvent>();
  const summaries = listeners<SessionSummary>();
  const skills = listeners<string | null>();
  const mcp = listeners<unknown>();
  const pull = listeners<PullUpdate>();
  let current: ConnectionState = { status: "connecting" };
  const raw = {
    get state() {
      return current;
    },
    ready: Promise.resolve(),
    onState: state.on,
    onEvent: event.on,
    onSessionSummary: summaries.on,
    onSkillsChanged: skills.on,
    onMcpStatus: mcp.on,
    onPull: pull.on,
    status: vi.fn(async () => ({ version: "1.0.0" })),
    attachSession: vi.fn<PageClient["attachSession"]>(async () => ({}) as never),
    detachSession: vi.fn<PageClient["detachSession"]>(async () => undefined),
    watchSessions: vi.fn(async () => undefined),
    createSession: vi.fn<PageClient["createSession"]>(async () => ({ session_id: "s_new" })),
    sendMessage: vi.fn<PageClient["sendMessage"]>(async () => ({}) as never),
    cancelRun: vi.fn<PageClient["cancelRun"]>(async () => ({}) as never),
    checkNow: vi.fn(),
    close: vi.fn(),
  };
  return {
    client: raw as unknown as PageClient,
    raw,
    setState(next: ConnectionState) {
      current = next;
      state.emit(next);
    },
    emitEvent: event.emit,
    emitSummary: summaries.emit,
    emitSkills: (root: string | null = null) => {
      skills.emit(root);
    },
    emitMcp: () => {
      mcp.emit({});
    },
    emitPull: pull.emit,
    eventListeners: event.size,
  };
}

/** A frame that runs only when the test says so. */
export function fakeFrame() {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    request: vi.fn((callback: () => void) => {
      const handle = next++;
      callbacks.set(handle, callback);
      return handle;
    }),
    cancel: vi.fn((handle: number) => {
      callbacks.delete(handle);
    }),
    run() {
      const all = [...callbacks.values()];
      callbacks.clear();
      for (const callback of all) callback();
    },
    pending: () => callbacks.size,
  };
}
