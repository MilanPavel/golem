import { OLLAMA_FAILED, RpcError, SESSION_BUSY, type ChatEvent, type ConnectionState, type OllamaInstallUpdate, type RuntimeInstallUpdate, type McpServerLog, type McpLoginDone, type ModelServerStatus, type MemoryChanged, type DevicePairChanged, type PullUpdate, type EvalUpdate, type SessionSummary, type WorkflowNotice, type DataChanged } from "@golem/client";
import { vi } from "vitest";
import type { ModelListResult } from "./models.ts";
import type { PageClient } from "./page.ts";

let seq = 0;

/** A failed call, as the client rejects it. */
export function rpcError(code: number, message: string, data?: Record<string, unknown>): RpcError {
  return new RpcError(code, message, data);
}

/** The code of a failed Ollama install; with `{ no_brew: true }` in its data, Homebrew is missing. */
export const OLLAMA_FAILED_CODE = OLLAMA_FAILED;

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
 * no welcome page at its start. A test about setup passes its own listing.
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
      tier: "local",
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
const WORKFLOW_RUN = { workflow_id: "x::x", name: "x", status: "done", trigger: "manual", inputs: {}, session_id: null, started_at: null, finished_at: null, error: null } as const;

export function fakeClient() {
  const state = listeners<ConnectionState>();
  const event = listeners<ChatEvent>();
  const summaries = listeners<SessionSummary>();
  const skills = listeners<string | null>();
  const agents = listeners<string | null>();
  const memory = listeners<MemoryChanged>();
  const devices = listeners<void>();
  const pairs = listeners<DevicePairChanged>();
  const routines = listeners<"changed" | "fired" | "finished">();
  const workflows = listeners<WorkflowNotice>();
  const data = listeners<DataChanged>();
  const mcp = listeners<unknown>();
  const mcpLog = listeners<McpServerLog>();
  const mcpLogin = listeners<McpLoginDone>();
  const runtime = listeners<RuntimeInstallUpdate>();
  const pull = listeners<PullUpdate>();
  const evals = listeners<EvalUpdate>();
  const server = listeners<ModelServerStatus>();
  const install = listeners<OllamaInstallUpdate>();
  const saved = listeners<{ model: string; saved: Record<string, number | string> }>();
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
    onAgentsChanged: agents.on,
    listAgents: vi.fn<PageClient["listAgents"]>(async () => ({ agents: [] })),
    setAgentWish: vi.fn<PageClient["setAgentWish"]>(async (name, wish) => ({ name, description: "", origin: "user", wish })),
    setAgentLimits: vi.fn<PageClient["setAgentLimits"]>(async (name) => ({ name, description: "", origin: "user", wish: "cheapest" })),
    setDefaultAgentLimits: vi.fn<PageClient["setDefaultAgentLimits"]>(async () => ({ ok: true, errors: [], values: { keep_days: 7, keep_problem_days: 30 } })),
    saveAgent: vi.fn<PageClient["saveAgent"]>(async () => ({ ok: true, problems: [] })),
    copyAgent: vi.fn<PageClient["copyAgent"]>(async (name) => ({ name, description: "", origin: "user", wish: "cheapest" })),
    deleteAgent: vi.fn<PageClient["deleteAgent"]>(async () => ({ agent: null })),
    onMemoryChanged: memory.on,
    listMemories: vi.fn<PageClient["listMemories"]>(async () => ({ items: [], total: 0, counts: {}, settings: {} })),
    updateMemory: vi.fn<PageClient["updateMemory"]>(async () => ({}) as never),
    deleteMemories: vi.fn<PageClient["deleteMemories"]>(async (ids) => ({ deleted: ids, missing: [] })),
    exportMemories: vi.fn<PageClient["exportMemories"]>(async (params) => ({ format: params.format, text: "", count: 0 })),
    memorySettings: vi.fn<PageClient["memorySettings"]>(async () => ({ settings: {} })),
    onDevicesChanged: (listener: () => void) => devices.on(() => listener()),
    onDevicePairChanged: pairs.on,
    deviceList: vi.fn<PageClient["deviceList"]>(async () => ({ devices: [] })),
    devicePairBegin: vi.fn<PageClient["devicePairBegin"]>(async () => ({ pair: "p1", uri: "golem://pair?v=1&relay=wss://relay.example.com&code=AAAA", expires_at: Math.floor(Date.now() / 1000) + 300 })),
    devicePairConfirm: vi.fn<PageClient["devicePairConfirm"]>(async (_pair, accept = true) => ({ device: accept ? { id: "a".repeat(32), name: "iPhone 16", paired_at: "2026-11-21T10:00:00+01:00", last_seen: null, revoked_at: null, rules: 0 } : null })),
    deviceRename: vi.fn<PageClient["deviceRename"]>(async (device, name) => ({ device: { id: device, name, paired_at: "2026-11-21T10:00:00+01:00", last_seen: null, revoked_at: null, rules: 0 } })),
    deviceRevoke: vi.fn<PageClient["deviceRevoke"]>(async (device) => ({ device: { id: device, name: "iPhone 16", paired_at: "2026-11-21T10:00:00+01:00", last_seen: null, revoked_at: "2026-11-21T13:00:00+01:00", rules: 0 }, revoked: true, rules: [] })),
    onRoutinesChanged: routines.on,
    onWorkflowEvent: workflows.on,
    onDataChanged: data.on,
    listData: vi.fn<PageClient["listData"]>(async () => ({ sources: [] })),
    describeData: vi.fn<PageClient["describeData"]>(async (source) => ({
      source: { name: source, kind: "files", scope: "user", location: "~/Documents/x/*.csv", privacy: "local", status: "ready" },
      tables: [],
      sample: {},
    })),
    inspectData: vi.fn<PageClient["inspectData"]>(async () => ({ kind: "files", tables: [], sample: {}, suggested_name: "x", suggested_privacy: "local" })),
    inspectDatabase: vi.fn<PageClient["inspectDatabase"]>(async () => ({ kind: "postgres", tables: [], sample: {}, suggested_name: "x", suggested_privacy: "local" })),
    profileData: vi.fn<PageClient["profileData"]>(async (source, table) => ({ source, table, rows: 0, columns: [] })),
    browseData: vi.fn<PageClient["browseData"]>(async () => ({ columns: [], rows: [], total_rows: 0, elapsed_ms: 0 })),
    browseDataKeep: vi.fn<PageClient["browseDataKeep"]>(async () => ({ result_id: "res_kept", rows: 0, truncated: false })),
    pageDataResult: vi.fn<PageClient["pageDataResult"]>(async (resultId) => ({ result_id: resultId, source: "bank", columns: [], rows: [], total_rows: 0, truncated: false, elapsed_ms: 0 })),
    exportDataResult: vi.fn<PageClient["exportDataResult"]>(async (_resultId, path) => ({ path, rows: 0 })),
    installDataExtension: vi.fn<PageClient["installDataExtension"]>(async () => ({})),
    addData: vi.fn<PageClient["addData"]>(async (params) => ({
      source: { name: params.name, kind: params.kind ?? "files", scope: params.scope, location: params.location, privacy: params.privacy, status: "ready" },
    })),
    updateData: vi.fn<PageClient["updateData"]>(async (params) => ({
      source: { name: params.name, kind: "files", scope: "user", location: "~/x", privacy: params.privacy ?? "local", status: "ready" },
    })),
    removeData: vi.fn<PageClient["removeData"]>(async () => ({})),
    getDataNotes: vi.fn<PageClient["getDataNotes"]>(async () => ({ text: null })),
    setDataNotes: vi.fn<PageClient["setDataNotes"]>(async () => ({ path: "~/.golem/data/x.md" })),
    draftDataNotes: vi.fn<PageClient["draftDataNotes"]>(async () => ({ text: "# x\n" })),
    queryData: vi.fn<PageClient["queryData"]>(async (params) => ({ result_id: "res_1", source: params.source, columns: [], rows: [], total_rows: 0, truncated: false, elapsed_ms: 1 })),
    saveDataQuery: vi.fn<PageClient["saveDataQuery"]>(async (params) => ({ query: { name: params.name, sql: params.sql, ...(params.description === undefined || params.description === null ? {} : { description: params.description }) } })),
    removeDataQuery: vi.fn<PageClient["removeDataQuery"]>(async () => ({})),
    listWorkflows: vi.fn<PageClient["listWorkflows"]>(async () => ({ workflows: [] })),
    listWorkflowStarters: vi.fn<PageClient["listWorkflowStarters"]>(async () => ({ starters: [] })),
    addWorkflowStarter: vi.fn<PageClient["addWorkflowStarter"]>(async (id) => ({ id: `/Users/me/.golem/workflows/${id}.py::${id}`, name: id, path: `/Users/me/.golem/workflows/${id}.py` })),
    getWorkflow: vi.fn<PageClient["getWorkflow"]>(async (id) => ({
      workflow: { id, name: id, path: "/Users/me/.golem/workflows/x.py", state: "ok", inputs: [], description: "" },
      steps: [],
      code: "",
    })),
    checkWorkflow: vi.fn<PageClient["checkWorkflow"]>(async () => ({ problems: [], steps: [] })),
    proposeWorkflow: vi.fn<PageClient["proposeWorkflow"]>(async (_id, code) => ({ code, note: "", steps: [], problems: [], model: "fake/model" })),
    createWorkflow: vi.fn<PageClient["createWorkflow"]>(async (name, folder, code) => {
      const file = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const path = `${folder ?? "/Users/me/.golem"}/workflows/${file}.py`;
      return {
        code: code ?? "",
        code_hash: "h1",
        problems: [],
        steps: [],
        workflow: { id: `${path}::${file}`, name: file, path, state: "ok", inputs: [], description: "" },
      };
    }),
    draftWorkflow: vi.fn<PageClient["draftWorkflow"]>(async () => ({ code: "", note: "", steps: [], problems: [], model: "fake/model" })),
    editWorkflowStep: vi.fn<PageClient["editWorkflowStep"]>(async (_id, code) => ({ code, problems: [], steps: [] })),
    saveWorkflow: vi.fn<PageClient["saveWorkflow"]>(async (id) => ({
      code_hash: "h2",
      problems: [],
      steps: [],
      workflow: { id, name: id, path: "/Users/me/.golem/workflows/x.py", state: "ok", inputs: [], description: "" },
    })),
    startWorkflow: vi.fn<PageClient["startWorkflow"]>(async () => ({ workflow_run_id: "wr_1" })),
    workflowStatus: vi.fn<PageClient["workflowStatus"]>(async (id) => ({ run: { ...WORKFLOW_RUN, workflow_run_id: id }, steps: [], reviews: [] })),
    cancelWorkflow: vi.fn<PageClient["cancelWorkflow"]>(async () => ({ cancelled: true })),
    readWorkflowOutput: vi.fn<PageClient["readWorkflowOutput"]>(async () => ({ path: "/tmp/x.md", text: "", truncated: false, size: 0 })),
    resumeWorkflow: vi.fn<PageClient["resumeWorkflow"]>(async (id) => ({ run: { ...WORKFLOW_RUN, workflow_run_id: id } })),
    answerWorkflowReview: vi.fn<PageClient["answerWorkflowReview"]>(async (id) => ({ run: { ...WORKFLOW_RUN, workflow_run_id: id } })),
    listRoutines: vi.fn<PageClient["listRoutines"]>(async () => ({ routines: [] })),
    listInbox: vi.fn<PageClient["listInbox"]>(async () => ({ posts: [] })),
    doneInbox: vi.fn<PageClient["doneInbox"]>(async (post_id) => ({ post_id })),
    listRuns: vi.fn<PageClient["listRuns"]>(async () => ({ runs: [] })),
    getRoutine: vi.fn<PageClient["getRoutine"]>(async (name) => ({ routine: { config: { name, prompt: "" }, path: "/Users/me/.golem/config.toml", source: "user" }, runs: [] })),
    runRoutine: vi.fn<PageClient["runRoutine"]>(async () => ({ routine_run_id: "rr_1", session_id: "s_run" })),
    removeRoutine: vi.fn<PageClient["removeRoutine"]>(async (name) => ({ name })),
    updateRoutine: vi.fn<PageClient["updateRoutine"]>(async (name, fields) => ({ routine: { config: { name, prompt: "", ...fields }, path: "/Users/me/.golem/config.toml", source: "user" } })),
    previewRoutine: vi.fn<PageClient["previewRoutine"]>(async () => ({ next: [] })),
    onMcpStatus: mcp.on,
    onPull: pull.on,
    onEval: evals.on,
    evalsPlan: vi.fn<PageClient["evalsPlan"]>(async () => ({ arms: [], running: null })),
    evalsStart: vi.fn<PageClient["evalsStart"]>(async () => ({ id: "m1" })),
    evalsStop: vi.fn<PageClient["evalsStop"]>(async () => ({ stopped: true })),
    evalsResume: vi.fn<PageClient["evalsResume"]>(async (id) => ({ id })),
    evalsList: vi.fn<PageClient["evalsList"]>(async () => ({ measurements: [] })),
    evalsGet: vi.fn<PageClient["evalsGet"]>(async (id) => ({ measurement: { id, arms: [], runs: [], started_at: "2026-11-24T14:00:00Z", state: "done" } })),
    evalsApply: vi.fn<PageClient["evalsApply"]>(async () => ({ ok: true, errors: [], values: { keep_days: 7, keep_problem_days: 30 } })),
    evalsDelete: vi.fn<PageClient["evalsDelete"]>(async () => ({ deleted: true })),
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
    stopHelper: vi.fn<PageClient["stopHelper"]>(async () => ({ stopped: true })),
    respondApproval: vi.fn<PageClient["respondApproval"]>(async () => ({}) as never),
    respondHelpers: vi.fn<PageClient["respondHelpers"]>(async () => ({ run_id: "r" })),
    applyHelper: vi.fn<PageClient["applyHelper"]>(async () => ({ change_ids: [] })),
    discardHelper: vi.fn<PageClient["discardHelper"]>(async () => undefined),
    retryHelper: vi.fn<PageClient["retryHelper"]>(async () => ({ helper_id: "h_new" })),
    answerConsent: vi.fn<PageClient["answerConsent"]>(async () => ({}) as never),
    listSkills: vi.fn<PageClient["listSkills"]>(async () => ({ skills: [] })),
    setSkills: vi.fn<PageClient["setSkills"]>(async () => ({}) as never),
    readSkill: vi.fn<PageClient["readSkill"]>(async () => ({ path: "/Users/me/.golem/skills/a/SKILL.md", text: "", mtime_ns: 1, source: "user" })),
    writeSkill: vi.fn<PageClient["writeSkill"]>(async () => ({ ok: true, written: true, mtime_ns: 2 })),
    createSkill: vi.fn<PageClient["createSkill"]>(async (params) => ({ path: `/Users/me/.golem/skills/${params.name}/SKILL.md`, mtime_ns: 1 })),
    setSkillDisabled: vi.fn<PageClient["setSkillDisabled"]>(async (name, disabled) => ({ name, disabled })),
    listKeys: vi.fn<PageClient["listKeys"]>(async () => ({ providers: [] })),
    setSessionMode: vi.fn<PageClient["setSessionMode"]>(async () => ({}) as never),
    setPlan: vi.fn<PageClient["setPlan"]>(async (sessionId, on) => ({ session_id: sessionId, on })),
    setChecks: vi.fn<PageClient["setChecks"]>(async (sessionId, on) => ({ session_id: sessionId, on })),
    setRoute: vi.fn<PageClient["setRoute"]>(async (sessionId, mode) => ({ session_id: sessionId, mode })),
    compactSession: vi.fn<PageClient["compactSession"]>(async () => ({ before_tokens: 100, after_tokens: 50, count: 0 })),
    getConfig: vi.fn<PageClient["getConfig"]>(async () => ({ rules: [] }) as never),
    localUi: false,
    gitInfo: vi.fn<PageClient["gitInfo"]>(async () => ({ repository: false, branch: null, root: null, detached: false, changed: 0, worktrees: [] })),
    gitBranches: vi.fn<PageClient["gitBranches"]>(async () => ({ branches: [] })),
    chooseFolder: vi.fn<PageClient["chooseFolder"]>(async () => ({ path: null })),
    reveal: vi.fn<PageClient["reveal"]>(async () => ({})),
    listDirs: vi.fn<PageClient["listDirs"]>(async () => ({ path: "/home/me", home: "/home/me", parent: null, entries: [], truncated: false })),
    getTraceSpan: vi.fn<PageClient["getTraceSpan"]>(async (_id, spanId) => ({ span: { id: spanId, kind: "tool", name: "t", start: "t", status: "ok" }, messages: [] }) as never),
    readArtifact: vi.fn<PageClient["readArtifact"]>(async () => ({ text: "", offset: 0, size: 0 })),
    changesList: vi.fn<PageClient["changesList"]>(async () => ({ files: [] })),
    changesDiff: vi.fn<PageClient["changesDiff"]>(async () => ({ diff: "", truncated: false })),
    changesRevert: vi.fn<PageClient["changesRevert"]>(async () => ({ reverted: [], conflicts: [] })),
    changesCommit: vi.fn<PageClient["changesCommit"]>(async () => ({ ok: true, sha: "a1b2c3d", output: "" })),
    changesCommitInfo: vi.fn<PageClient["changesCommitInfo"]>(async () => ({ repository: false, branch: null, paths: [] })),
    changesSuggestMessage: vi.fn<PageClient["changesSuggestMessage"]>(async () => ({ message: "" })),
    readFile: vi.fn<PageClient["readFile"]>(async (_id, path) => ({ path, text: "", truncated: false, lines: 0 })),
    listFiles: vi.fn<PageClient["listFiles"]>(async () => ({ paths: [], more: false })),
    getCost: vi.fn<PageClient["getCost"]>(async () => ({
      today: { calls: 0, input: 0, output: 0, cost_usd: 0, saved_usd: 0 },
      week: { calls: 0, input: 0, output: 0, cost_usd: 0, saved_usd: 0 },
      by_model: [],
      by_day: [],
    })),
    getRouting: vi.fn<PageClient["getRouting"]>(async () => ({
      routing: { mode: "pinned", paid: "ask", budget_max_price: 1.5, local_only: [] },
      ladder: {},
      roles: { titles: "session", summarise: "session", explore: "session" },
      budget: { over: "local" },
      context: { window: "auto", keep_alive: "30m", reply_reserve: 4096, clear_at: 0.7, clear_to: 0.4, compact_at: 0.85, keep_results: 4, keep_turns: 4 },
      picked: {},
    })),
    setRouting: vi.fn<PageClient["setRouting"]>(async () => ({ ok: true, errors: [] })),
    getChat: vi.fn<PageClient["getChat"]>(async () => ({ instructions: [], plan_first: false, mode: "balanced" })),
    setChat: vi.fn<PageClient["setChat"]>(async (params) => ({ ok: true, errors: [], values: { instructions: params.instructions ?? [], plan_first: params.plan_first ?? false, mode: "balanced" } })),
    getChatPrompt: vi.fn<PageClient["getChatPrompt"]>(async () => ({ model: null, parts: [], tools_tokens: 0, total_tokens: 0 })),
    getChatSuggestions: vi.fn<PageClient["getChatSuggestions"]>(async () => ({ suggestions: [], updated: null, needs_local_model: false })),
    dismissChatSuggestion: vi.fn<PageClient["dismissChatSuggestion"]>(async () => ({ ok: true })),
    draftChat: vi.fn<PageClient["draftChat"]>(async () => ({ lines: [], model: "ollama/qwen3" })),
    getNotifications: vi.fn<PageClient["getNotifications"]>(async () => ({
      needs_you: true,
      failed: true,
      finished: false,
      open_in: "web",
      terminal_app: "Terminal",
      terminal_apps: ["Terminal", "iTerm", "Ghostty"],
    })),
    setNotifications: vi.fn<PageClient["setNotifications"]>(async () => ({ ok: true, errors: [] })),
    agentsKeep: vi.fn<PageClient["agentsKeep"]>(async () => ({ ok: true, errors: [], values: { keep_days: 7, keep_problem_days: 30 } })),
    notifyTest: vi.fn<PageClient["notifyTest"]>(async () => ({ posted: true, mechanism: "osascript" })),
    getTrace: vi.fn<PageClient["getTrace"]>(async (sessionId) => ({ session_id: sessionId, title: null, runs: [] })),
    listMcp: vi.fn<PageClient["listMcp"]>(async () => ({ servers: [] })),
    mcpTools: vi.fn<PageClient["mcpTools"]>(async (name) => ({ name, tools: [] })),
    restartMcp: vi.fn<PageClient["restartMcp"]>(async () => ({}) as never),
    setMcpEnabled: vi.fn<PageClient["setMcpEnabled"]>(async () => ({}) as never),
    enableMcp: vi.fn<PageClient["enableMcp"]>(async () => ({}) as never),
    disableMcp: vi.fn<PageClient["disableMcp"]>(async () => ({}) as never),
    mcpTest: vi.fn<PageClient["mcpTest"]>(async () => ({ test_id: "t", ok: true, steps: [], tools: [], stderr_tail: [] })),
    mcpLogs: vi.fn<PageClient["mcpLogs"]>(async (name) => ({ name, lines: [] })),
    onMcpLog: mcpLog.on,
    mcpLogin: vi.fn<PageClient["mcpLogin"]>(async (name) => ({ name, authorize_url: "https://auth.example/authorize?state=x" })),
    mcpLogout: vi.fn<PageClient["mcpLogout"]>(async () => ({}) as never),
    onMcpLoginDone: mcpLogin.on,
    mcpCall: vi.fn<PageClient["mcpCall"]>(async () => ({ text: "", is_error: false })),
    mcpGet: vi.fn<PageClient["mcpGet"]>(async () => ({ config: {} }) as never),
    addMcpServer: vi.fn<PageClient["addMcpServer"]>(async () => ({}) as never),
    configRawGet: vi.fn<PageClient["configRawGet"]>(async () => ({ exists: true, mtime_ns: 1, path: "/Users/me/.golem/config.toml", text: "" })),
    configRawSet: vi.fn<PageClient["configRawSet"]>(async () => ({ ok: true, mtime_ns: 2 })),
    scanMcpImport: vi.fn<PageClient["scanMcpImport"]>(async () => ({ scan_id: "scan", sources: [] })),
    applyMcpImport: vi.fn<PageClient["applyMcpImport"]>(async () => ({ added: [] })),
    mcpCatalog: vi.fn<PageClient["mcpCatalog"]>(async () => ({ entries: [] })),
    installRuntime: vi.fn<PageClient["installRuntime"]>(async (name) => ({ name, started: true })),
    cancelRuntimeInstall: vi.fn<PageClient["cancelRuntimeInstall"]>(async (name) => ({ name, cancelled: true })),
    onRuntimeInstall: runtime.on,
    updateMcpServer: vi.fn<PageClient["updateMcpServer"]>(async () => ({}) as never),
    removeMcpServer: vi.fn<PageClient["removeMcpServer"]>(async (name) => ({ name, secret: false })),
    updateRule: vi.fn<PageClient["updateRule"]>(async () => ({}) as never),
    removeRule: vi.fn<PageClient["removeRule"]>(async () => ({}) as never),
    revokeAllowance: vi.fn<PageClient["revokeAllowance"]>(async () => true),
    listModels: vi.fn<PageClient["listModels"]>(async () => EMPTY_LISTING),
    setSessionModel: vi.fn<PageClient["setSessionModel"]>(async () => ({}) as never),
    setDefaultPermissionMode: vi.fn<PageClient["setDefaultPermissionMode"]>(async (mode) => ({ mode, path: "/h/config.toml" })),
    setDefaultModel: vi.fn<PageClient["setDefaultModel"]>(async () => ({}) as never),
    starModel: vi.fn<PageClient["starModel"]>(async () => ({ starred: [] })),
    getOllamaSettings: vi.fn<PageClient["getOllamaSettings"]>(async () => ({ start: true, idle_stop_minutes: 30, parallel: 1, started_by_golem: true, running: true })),
    setOllamaSettings: vi.fn<PageClient["setOllamaSettings"]>(async (params) => ({
      ok: true,
      errors: [],
      values: { start: params.start ?? true, idle_stop_minutes: params.idle_stop_minutes ?? 30, parallel: params.parallel ?? 1, started_by_golem: true, running: true },
    })),
    getModelOptions: vi.fn<PageClient["getModelOptions"]>(async (model) => ({ model, options: [], defaults: {}, saved: {}, session: {} })),
    setModelOptions: vi.fn<PageClient["setModelOptions"]>(async (model) => ({ model, saved: {} })),
    setSessionOptions: vi.fn<PageClient["setSessionOptions"]>(async (id) => ({ session_id: id, options: {} })),
    onOptionsSaved: saved.on,
    pullModel: vi.fn<PageClient["pullModel"]>(async (ref) => ({ ref, started: true }) as never),
    cancelPull: vi.fn<PageClient["cancelPull"]>(async (ref) => ({ ref, cancelled: true }) as never),
    cleanupPull: vi.fn<PageClient["cleanupPull"]>(async (ref) => ({ ref, freed_gb: 0 })),
    deleteModel: vi.fn<PageClient["deleteModel"]>(async (ref) => ({ ref, deleted: true }) as never),
    searchHf: vi.fn<PageClient["searchHf"]>(async () => ({ repos: [] })),
    hfFiles: vi.fn<PageClient["hfFiles"]>(async (repo) => ({ repo, sizes: [] })),
    ollamaLibrary: vi.fn<PageClient["ollamaLibrary"]>(async () => ({ models: [] })),
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
    emitMemory: memory.emit,
    emitDevices: () => {
      devices.emit();
    },
    emitPair: pairs.emit,
    emitSkills: (root: string | null = null) => {
      skills.emit(root);
    },
    emitAgents: (root: string | null = null) => {
      agents.emit(root);
    },
    emitWorkflow: workflows.emit,
    emitData: data.emit,
    emitRoutines: (kind: "changed" | "fired" | "finished" = "changed") => {
      routines.emit(kind);
    },
    emitMcpLog: mcpLog.emit,
    emitMcpLoginDone: mcpLogin.emit,
    emitRuntime: runtime.emit,
    emitMcp: () => {
      mcp.emit({});
    },
    emitPull: pull.emit,
    emitEval: evals.emit,
    emitModelServer: server.emit,
    emitInstall: install.emit,
    emitOptionsSaved: saved.emit,
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
