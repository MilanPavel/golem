import { OLLAMA_FAILED, RpcError, type ApprovalChoice, type ConfigGetResult, type FsListDirsResult, type McpAddParams, type McpCallResult, type McpCatalogResult, type McpListResult, type McpLogsResult, type McpServerConfig, type McpServerDetail, type McpServerLog, type McpTestProgress, type McpTestResult, type GolemClient, type RuntimeName, type SetupStatusResult, type SkillListResult } from "@golem/client";
import { changeToolFilter, installEventOf, type InstallEvent } from "@golem/view";
import type { QueryClient } from "@tanstack/react-query";
import { createDrafts, type Drafts } from "./drafts.ts";
import { createConnectionStore, type ConnectionStore } from "./connection.ts";
import { createNewSession, type NewSessionStore } from "./new-session.ts";
import { CONFIG_KEY } from "./config.ts";
import { MCP_CATALOG_KEY, MCP_LIST_KEY, MCP_TOOLS_KEY, type McpToolsResult } from "./mcp.ts";
import { MODEL_LIST_ALL_KEY, MODEL_LIST_KEY, SETUP_STATUS_KEY, type ModelListResult } from "./models.ts";
import { createPulls, type Pulls } from "./pulls.ts";
import { createQueryClient, keepQueriesHonest } from "./query.ts";
import { createRouter, type Router } from "./router.ts";
import { createSessionList, type SessionList } from "./session-list.ts";
import type { Frame, SessionStore } from "./session-store.ts";
import { createSessions, type Sessions } from "./sessions.ts";
import { createSetupStart, type SetupStart } from "./setup-start.ts";

/** What the page needs of the client. */
export type PageClient = Pick<
  GolemClient,
  | "state"
  | "ready"
  | "onState"
  | "onEvent"
  | "onSessionSummary"
  | "onSkillsChanged"
  | "onMcpStatus"
  | "onPull"
  | "onModelServer"
  | "status"
  | "attachSession"
  | "detachSession"
  | "watchSessions"
  | "createSession"
  | "sendMessage"
  | "renameSession"
  | "forkSession"
  | "closeSession"
  | "cancelRun"
  | "listModels"
  | "listSkills"
  | "setSkills"
  | "getConfig"
  | "listMcp"
  | "mcpTools"
  | "restartMcp"
  | "setMcpEnabled"
  | "enableMcp"
  | "disableMcp"
  | "mcpTest"
  | "mcpLogs"
  | "onMcpLog"
  | "mcpCall"
  | "mcpGet"
  | "updateMcpServer"
  | "addMcpServer"
  | "mcpCatalog"
  | "installRuntime"
  | "cancelRuntimeInstall"
  | "onRuntimeInstall"
  | "removeMcpServer"
  | "listDirs"
  | "updateRule"
  | "removeRule"
  | "revokeAllowance"
  | "setSessionModel"
  | "setDefaultModel"
  | "pullModel"
  | "cancelPull"
  | "deleteModel"
  | "setupStatus"
  | "startOllama"
  | "installOllama"
  | "cancelOllamaInstall"
  | "onOllamaInstall"
  | "respondApproval"
  | "checkNow"
  | "close"
>;

/** Thin calls on the client. Their results arrive as events, so there is nothing to merge. */
export type PageActions = {
  /** Starts a session in `cwd` on `model` (null: the default). */
  createSession(cwd: string | null, model: string | null): Promise<string>;
  /** Sends a message. With `skill`, the daemon fills the skill's body in from `args`. */
  send(sessionId: string, text: string, skill?: { name: string; args: string }): Promise<void>;
  /** Pins a skill for the session, or unpins it. The pinned list arrives as `chat.activeSkills`. */
  pinSkill(sessionId: string, name: string, pin: boolean): Promise<void>;
  cancel(runId: string): Promise<void>;
  /** Sets the title. What the page shows afterwards comes from the daemon's summary. */
  rename(sessionId: string, title: string): Promise<void>;
  /** Forks at a message and resolves with the new session's id. */
  fork(sessionId: string, atMessageId: string): Promise<string>;
  close(sessionId: string): Promise<void>;
  respond(sessionId: string, callId: string, decision: ApprovalChoice, args?: Readonly<Record<string, unknown>>): Promise<void>;
  /** Switches the session's model. The chip changes from the daemon's `model.selected` event. */
  useModel(sessionId: string, name: string): Promise<void>;
  setDefault(name: string): Promise<void>;
  /**
   * Starts a download. With `after`, the page switches that session to the model when the
   * download ends well, even if the dialog that asked is closed by then.
   */
  pull(ref: string, after?: { sessionId: string }): Promise<void>;
  /** Makes `name` the default model when the download of `ref` ends well, even with every dialog closed. */
  defaultWhenPulled(ref: string, name: string): void;
  /** Stops a download. Ollama keeps the bytes for the next try. */
  cancelPull(ref: string): Promise<void>;
  /** Dismiss the failure of a download. */
  forgetPull(ref: string): void;
  remove(ref: string): Promise<void>;
  /** Sets an existing rule's action. `cwd` goes with a rule of the folder's `.golem/policy.toml` only. */
  updateRule(target: "user" | "project", index: number, action: "allow" | "ask" | "deny", cwd: string | undefined): Promise<void>;
  /** Deletes a rule. `cwd` goes with a rule of the folder's `.golem/policy.toml` only. */
  removeRule(target: "user" | "project", index: number, cwd: string | undefined): Promise<void>;
  /** Drops something the session allows for the rest of the session. */
  revokeAllowance(sessionId: string, tool: string, subject: string | null): Promise<void>;
  /** Starts a server again. `sessionId` is the one whose project the server may belong to. */
  restartMcp(name: string, sessionId: string | null): Promise<void>;
  /** Writes `enabled` into the file that names the server: on for every chat, off everywhere, or on demand. */
  setMcpEnabled(name: string, enabled: boolean | "on_demand", sessionId: string | null): Promise<void>;
  /** Tests a saved server. `onStep` gets each step as it ends. */
  testMcp(name: string, sessionId: string | null, onStep: (step: McpTestProgress) => void): Promise<McpTestResult>;
  /** The server's last log lines, oldest first. */
  mcpLogs(name: string, sessionId: string | null): Promise<McpLogsResult>;
  /** New log lines of any server, until the returned function is called. */
  watchMcpLog(listener: (log: McpServerLog) => void): () => void;
  /** Runs one tool by hand, by the server's own tool name. No approval, and no session records it. */
  callMcp(name: string, tool: string, args: Record<string, unknown>, sessionId: string | null): Promise<McpCallResult>;
  /**
   * Hides a tool from the model, or shows it again, by writing the server's `tools.exclude`. Rejects
   * with the reason when the tool is hidden by a pattern the page cannot take out.
   */
  setMcpToolHidden(name: string, tool: string, hide: boolean, sessionId: string | null): Promise<void>;
  /** Removes a server from the user's config, with the token it stored. */
  removeMcp(name: string): Promise<void>;
  /** One server's whole config, with secrets as Keychain references, and the file that names it. */
  getMcp(name: string, sessionId: string | null): Promise<McpServerDetail>;
  /** Replaces the server's `[mcp.<name>]`. `secrets` (by reference) are stored first, and only those sent change. */
  updateMcp(name: string, config: McpServerConfig, secrets: Record<string, string>, sessionId: string | null): Promise<void>;
  /** Adds a server to the user's config and starts it. Rejects with the daemon's reason. */
  addMcp(params: McpAddParams): Promise<void>;
  /** Tries a server that is not saved yet, saving nothing. `onStep` gets each step as it ends. */
  testMcpDraft(
    draft: { catalogId: string; inputs: Record<string, string>; secrets: Record<string, string>; name: string } | { config: McpServerConfig; secrets: Record<string, string> },
    sessionId: string | null,
    onStep: (step: McpTestProgress) => void,
  ): Promise<McpTestResult>;
  /**
   * Installs Node or uv with Homebrew, run by the daemon. `onEvent` gets the output and the end, and
   * the subscription ends with it. Resolves false when an install of it was already running.
   */
  installRuntime(name: RuntimeName, onEvent: (event: InstallEvent) => void): Promise<boolean>;
  cancelRuntimeInstall(name: RuntimeName): Promise<void>;
  /** Turns an on-demand server on or off for one session. */
  toggleMcp(sessionId: string, name: string, on: boolean): Promise<void>;
  /** Asks the providers again, past the daemon's cache, puts the answer in the listing, and returns it. */
  refreshModels(showAll?: boolean): Promise<ModelListResult>;
  /** Starts Ollama. True when it answers afterwards. */
  startOllama(): Promise<boolean>;
  /**
   * Installs Ollama with Homebrew, run by the daemon. `onEvent` gets its output and its end, and
   * the subscription ends with it. Resolves "no_brew" when the Mac has no Homebrew, and rejects
   * for any other refusal.
   */
  installOllama(onEvent: (event: InstallEvent) => void): Promise<"started" | "no_brew">;
  /** Stops the install the daemon is running. */
  cancelOllamaInstall(): Promise<void>;
};

/** What each query key fetches. */
export type PageQueries = {
  modelList(showAll?: boolean): Promise<ModelListResult>;
  /** The overview rows, from the same checks as `golem doctor`. */
  setupStatus(): Promise<SetupStatusResult>;
  /** The skills a folder sees. `null` is no folder. */
  skillList(cwd: string | null): Promise<SkillListResult>;
  /** The tool rules in check order, and what the session allows. `null` is no folder or no session. */
  config(cwd: string | null, sessionId: string | null): Promise<ConfigGetResult>;
  /** The MCP servers a session sees. `null` is no session. */
  mcpList(sessionId: string | null): Promise<McpListResult>;
  /** One server's tools, with their descriptions. */
  mcpTools(name: string, sessionId: string | null): Promise<McpToolsResult>;
  /** The servers golem offers to add, with what each needs here. */
  mcpCatalog(sessionId: string | null): Promise<McpCatalogResult>;
  /** The folders directly under `path` in the home folder; `null` is home itself. */
  dirs(path: string | null): Promise<FsListDirsResult>;
};

export type Page = {
  connection: ConnectionStore;
  sessions: Sessions;
  sessionList: SessionList;
  newSession: NewSessionStore;
  drafts: Drafts;
  pulls: Pulls;
  setupStart: SetupStart;
  queryClient: QueryClient;
  queries: PageQueries;
  router: Router;
  actions: PageActions;
  /**
   * Use a session: it opens on the first acquire and closes after the last release. The close
   * waits one tick, so a release followed at once by an acquire (React's strict-mode remount)
   * keeps the attachment.
   */
  acquire(id: string): { store: SessionStore; release(): void };
  start(): void;
  stop(): void;
};

export type PageOptions = { frame?: Frame; doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> };

/** Everything the page holds, built on one client. */
export function createPage(client: PageClient, options: PageOptions = {}): Page {
  const connection = createConnectionStore(() => client);
  const sessions = createSessions(client, options.frame);
  const sessionList = createSessionList(client);
  const newSession = createNewSession();
  const drafts = createDrafts();
  const queryClient = createQueryClient();
  const pulls = createPulls(client, Date.now, () => {
    void queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
    void queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
  });
  const setupStart = createSetupStart();
  const router = createRouter();
  const doc = options.doc ?? document;
  const uses = new Map<string, { count: number; timer: ReturnType<typeof setTimeout> | undefined }>();
  let stopQueries: (() => void) | undefined;
  let started = false;

  function onVisibility(): void {
    if (doc.visibilityState === "visible") {
      client.checkNow();
    }
  }

  return {
    connection,
    sessions,
    sessionList,
    newSession,
    drafts,
    pulls,
    setupStart,
    queryClient,
    queries: {
      modelList: (showAll = false) => client.listModels(false, showAll),
      setupStatus: () => client.setupStatus(),
      skillList: (cwd) => (cwd === null ? client.listSkills() : client.listSkills(cwd)),
      config: (cwd, sessionId) => client.getConfig(cwd ?? undefined, sessionId ?? undefined),
      mcpList: (sessionId) => client.listMcp(sessionId ?? undefined),
      mcpTools: (name, sessionId) => client.mcpTools(name, sessionId ?? undefined),
      mcpCatalog: (sessionId) => client.mcpCatalog(sessionId ?? undefined),
      dirs: (path) => (path === null ? client.listDirs() : client.listDirs(path)),
    },
    router,
    actions: {
      async createSession(cwd, model) {
        const options: { cwd?: string; modelProfile?: string } = {};
        if (cwd !== null) options.cwd = cwd;
        if (model !== null) options.modelProfile = model;
        const created = await client.createSession(Object.keys(options).length === 0 ? undefined : options);
        return created.session_id;
      },
      async send(sessionId, text, skill) {
        if (skill === undefined) await client.sendMessage(sessionId, text);
        else await client.sendMessage(sessionId, text, { skill });
      },
      async pinSkill(sessionId, name, pin) {
        await client.setSkills(sessionId, pin ? { pin: [name] } : { unpin: [name] });
      },
      async cancel(runId) {
        await client.cancelRun(runId);
      },
      async rename(sessionId, title) {
        await client.renameSession(sessionId, title);
      },
      async fork(sessionId, atMessageId) {
        const forked = await client.forkSession(sessionId, atMessageId);
        return forked.session_id;
      },
      async close(sessionId) {
        await client.closeSession(sessionId);
      },
      async respond(sessionId, callId, decision, args) {
        if (args === undefined) await client.respondApproval(sessionId, callId, decision);
        else await client.respondApproval(sessionId, callId, decision, args);
      },
      async updateRule(target, index, action, cwd) {
        try {
          if (cwd === undefined) await client.updateRule(target, index, action);
          else await client.updateRule(target, index, action, cwd);
        } finally {
          await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
        }
      },
      async removeRule(target, index, cwd) {
        try {
          if (cwd === undefined) await client.removeRule(target, index);
          else await client.removeRule(target, index, cwd);
        } finally {
          await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
        }
      },
      async restartMcp(name, sessionId) {
        try {
          await client.restartMcp(name, sessionId ?? undefined);
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
        }
      },
      async setMcpEnabled(name, enabled, sessionId) {
        try {
          await client.setMcpEnabled(name, enabled, sessionId ?? undefined);
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
        }
      },
      testMcp: (name, sessionId, onStep) => client.mcpTest({ name, ...(sessionId === null ? {} : { sessionId }) }, onStep),
      mcpLogs: (name, sessionId) => client.mcpLogs(name, sessionId === null ? {} : { sessionId }),
      watchMcpLog: (listener) => client.onMcpLog(listener),
      callMcp: (name, tool, args, sessionId) => client.mcpCall({ name, tool, arguments: args, ...(sessionId === null ? {} : { sessionId }) }),
      async setMcpToolHidden(name, tool, hide, sessionId) {
        const detail = await client.mcpGet(name, sessionId ?? undefined);
        const change = hide ? changeToolFilter(detail.config, [tool], []) : changeToolFilter(detail.config, [], [tool]);
        if (!change.ok) throw new Error(change.message);
        try {
          await client.updateMcpServer({ name, config: change.config, ...(sessionId === null ? {} : { session_id: sessionId }) });
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_TOOLS_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
        }
      },
      async removeMcp(name) {
        try {
          await client.removeMcpServer(name);
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_CATALOG_KEY });
        }
      },
      getMcp: (name, sessionId) => client.mcpGet(name, sessionId ?? undefined),
      async updateMcp(name, config, secrets, sessionId) {
        try {
          await client.updateMcpServer({
            name,
            config,
            ...(Object.keys(secrets).length === 0 ? {} : { secrets }),
            ...(sessionId === null ? {} : { session_id: sessionId }),
          });
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_TOOLS_KEY });
        }
      },
      async addMcp(params) {
        try {
          await client.addMcpServer(params);
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_CATALOG_KEY });
        }
      },
      testMcpDraft: (draft, sessionId, onStep) => {
        const session = sessionId === null ? {} : { sessionId };
        return client.mcpTest(
          "catalogId" in draft
            ? { catalogId: draft.catalogId, inputs: draft.inputs, secrets: draft.secrets, name: draft.name, ...session }
            : { config: draft.config, secrets: draft.secrets, ...session },
          onStep,
        );
      },
      async installRuntime(name, onEvent) {
        let off: (() => void) | null = null;
        const end = (): void => {
          off?.();
          off = null;
        };
        off = client.onRuntimeInstall((update) => {
          if (update.kind === "output") {
            if (update.name === name) onEvent({ kind: "output", text: update.text });
            return;
          }
          if (update.done.name !== name) return;
          end();
          onEvent(
            update.done.ok
              ? { kind: "exit", code: 0, stopped: false }
              : update.done.error == null
                ? { kind: "exit", code: null, stopped: true }
                : { kind: "error", message: update.done.error },
          );
          void queryClient.invalidateQueries({ queryKey: MCP_CATALOG_KEY });
        });
        try {
          const result = await client.installRuntime(name);
          if (!result.started) end();
          return result.started;
        } catch (failure) {
          end();
          throw failure;
        }
      },
      async cancelRuntimeInstall(name) {
        await client.cancelRuntimeInstall(name);
      },
      async toggleMcp(sessionId, name, on) {
        try {
          await (on ? client.enableMcp(sessionId, name) : client.disableMcp(sessionId, name));
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
        }
      },
      async revokeAllowance(sessionId, tool, subject) {
        try {
          await client.revokeAllowance(sessionId, tool, subject);
        } finally {
          await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
        }
      },
      async useModel(sessionId, name) {
        await client.setSessionModel(sessionId, name);
      },
      async setDefault(name) {
        await client.setDefaultModel(name);
        await queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
        await queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
      },
      async pull(ref, after) {
        pulls.begin(ref);
        if (after !== undefined) pulls.switchWhenDone(ref, after.sessionId);
        try {
          await client.pullModel(ref);
        } catch (error) {
          pulls.abort(ref);
          throw error;
        }
      },
      defaultWhenPulled(ref, name) {
        pulls.defaultWhenDone(ref, name);
      },
      forgetPull(ref) {
        pulls.forget(ref);
      },
      async cancelPull(ref) {
        pulls.forget(ref);
        await client.cancelPull(ref);
      },
      async remove(ref) {
        await client.deleteModel(ref);
        await queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
      },
      async refreshModels(showAll = false) {
        const listing = await client.listModels(true, showAll);
        queryClient.setQueryData(showAll ? MODEL_LIST_ALL_KEY : MODEL_LIST_KEY, listing);
        void queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
        return listing;
      },
      async startOllama() {
        const { running } = await client.startOllama();
        void queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
        void queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
        return running;
      },
      async installOllama(onEvent) {
        const off = client.onOllamaInstall((update) => {
          const event = installEventOf(update);
          if (event.kind !== "output") off();
          onEvent(event);
        });
        try {
          await client.installOllama();
          return "started";
        } catch (error) {
          off();
          if (error instanceof RpcError && error.code === OLLAMA_FAILED && error.data?.["no_brew"] === true) return "no_brew";
          throw error;
        }
      },
      async cancelOllamaInstall() {
        await client.cancelOllamaInstall();
      },
    },
    acquire(id) {
      const use = uses.get(id) ?? { count: 0, timer: undefined };
      uses.set(id, use);
      clearTimeout(use.timer);
      use.timer = undefined;
      use.count += 1;
      const store = sessions.open(id);
      let released = false;
      return {
        store,
        release() {
          if (released) {
            return;
          }
          released = true;
          use.count -= 1;
          if (use.count > 0) {
            return;
          }
          use.timer = setTimeout(() => {
            use.timer = undefined;
            if (use.count === 0 && uses.get(id) === use) {
              uses.delete(id);
              sessions.close(id);
            }
          }, 0);
        },
      };
    },
    start() {
      if (started) {
        return;
      }
      started = true;
      connection.start();
      sessionList.start();
      pulls.start();
      stopQueries = keepQueriesHonest(client, queryClient);
      doc.addEventListener("visibilitychange", onVisibility);
    },
    stop() {
      started = false;
      doc.removeEventListener("visibilitychange", onVisibility);
      stopQueries?.();
      stopQueries = undefined;
      sessionList.stop();
      pulls.stop();
      sessions.stop();
      router.stop();
      queryClient.clear();
      connection.stop();
    },
  };
}
