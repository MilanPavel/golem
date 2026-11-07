import { RpcError, SESSION_BUSY, type ChatEvent, type ConnectionState, type OllamaInstallUpdate, type ModelServerStatus, type PullUpdate, type SessionSummary } from "@golem/client";
import { vi } from "vitest";
import type { ModelListResult } from "./models.ts";
import type { PageClient } from "./page.ts";

let seq = 0;

/** A failed call, as the client rejects it. */
export function rpcError(code: number, message: string): RpcError {
  return new RpcError(code, message);
}

export const SESSION_BUSY_CODE = SESSION_BUSY;
export const INVALID_PARAMS_CODE = -32602;

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

/**
 * A listing for a setup that works: the default names a model that is ready, so the page opens
 * no setup window at its start. A test about setup passes its own listing.
 */
const EMPTY_LISTING: ModelListResult = {
  default: "ollama/qwen3:8b",
  models: [
    {
      ref: "ollama/qwen3:8b",
      label: "Qwen3 8B",
      provider: "ollama",
      source: "installed",
      status: "ready",
      price: { input: 0, output: 0 },
    },
  ],
  providers: [{ provider: "ollama", status: "ready" }],
  setup: { ollama_installed: true, ollama_running: true },
};

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
  const server = listeners<ModelServerStatus>();
  const install = listeners<OllamaInstallUpdate>();
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
    onModelServer: server.on,
    onOllamaInstall: install.on,
    setupStatus: vi.fn<PageClient["setupStatus"]>(async () => ({ rows: [] })),
    startOllama: vi.fn<PageClient["startOllama"]>(async () => ({ running: true })),
    installOllama: vi.fn<PageClient["installOllama"]>(async () => ({ started: true })),
    cancelOllamaInstall: vi.fn<PageClient["cancelOllamaInstall"]>(async () => ({ cancelled: true })),
    status: vi.fn(async () => ({ version: "1.0.0" })),
    attachSession: vi.fn<PageClient["attachSession"]>(async () => ({}) as never),
    detachSession: vi.fn<PageClient["detachSession"]>(async () => undefined),
    watchSessions: vi.fn(async () => undefined),
    createSession: vi.fn<PageClient["createSession"]>(async () => ({ session_id: "s_new" })),
    renameSession: vi.fn<PageClient["renameSession"]>(async (_id, title) => ({ title }) as never),
    forkSession: vi.fn<PageClient["forkSession"]>(async () => ({ session_id: "s_fork" }) as never),
    closeSession: vi.fn<PageClient["closeSession"]>(async () => ({}) as never),
    sendMessage: vi.fn<PageClient["sendMessage"]>(async () => ({}) as never),
    cancelRun: vi.fn<PageClient["cancelRun"]>(async () => ({}) as never),
    respondApproval: vi.fn<PageClient["respondApproval"]>(async () => ({}) as never),
    listSkills: vi.fn<PageClient["listSkills"]>(async () => ({ skills: [] })),
    setSkills: vi.fn<PageClient["setSkills"]>(async () => ({}) as never),
    getConfig: vi.fn<PageClient["getConfig"]>(async () => ({ rules: [] }) as never),
    listDirs: vi.fn<PageClient["listDirs"]>(async () => ({ path: "/home/me", home: "/home/me", parent: null, entries: [], truncated: false })),
    updateRule: vi.fn<PageClient["updateRule"]>(async () => ({}) as never),
    removeRule: vi.fn<PageClient["removeRule"]>(async () => ({}) as never),
    revokeAllowance: vi.fn<PageClient["revokeAllowance"]>(async () => true),
    listModels: vi.fn<PageClient["listModels"]>(async () => EMPTY_LISTING),
    setSessionModel: vi.fn<PageClient["setSessionModel"]>(async () => ({}) as never),
    setDefaultModel: vi.fn<PageClient["setDefaultModel"]>(async () => ({}) as never),
    pullModel: vi.fn<PageClient["pullModel"]>(async (ref) => ({ ref, started: true }) as never),
    cancelPull: vi.fn<PageClient["cancelPull"]>(async (ref) => ({ ref, cancelled: true }) as never),
    deleteModel: vi.fn<PageClient["deleteModel"]>(async (ref) => ({ ref, deleted: true }) as never),
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
    emitModelServer: server.emit,
    emitInstall: install.emit,
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
