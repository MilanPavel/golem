import type { ApprovalChoice, GolemClient, SkillListResult } from "@golem/client";
import type { QueryClient } from "@tanstack/react-query";
import { createDrafts, type Drafts } from "./drafts.ts";
import { createConnectionStore, type ConnectionStore } from "./connection.ts";
import { createNewSessionFolder, type NewSessionFolderStore } from "./new-session.ts";
import { MODEL_LIST_KEY, type ModelListResult } from "./models.ts";
import { createPulls, type Pulls } from "./pulls.ts";
import { createQueryClient, keepQueriesHonest } from "./query.ts";
import { createRouter, type Router } from "./router.ts";
import { createSessionList, type SessionList } from "./session-list.ts";
import type { Frame, SessionStore } from "./session-store.ts";
import { createSessions, type Sessions } from "./sessions.ts";

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
  | "setSessionModel"
  | "setDefaultModel"
  | "pullModel"
  | "cancelPull"
  | "deleteModel"
  | "respondApproval"
  | "checkNow"
  | "close"
>;

/** Thin calls on the client. Their results arrive as events, so there is nothing to merge. */
export type PageActions = {
  createSession(cwd: string | null): Promise<string>;
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
  /** Stops a download. Ollama keeps the bytes for the next try. */
  cancelPull(ref: string): Promise<void>;
  remove(ref: string): Promise<void>;
  /** Asks the providers again, past the daemon's cache, and puts the answer in the listing. */
  refreshModels(): Promise<void>;
};

/** What each query key fetches. */
export type PageQueries = {
  modelList(): Promise<ModelListResult>;
  /** The skills a folder sees. `null` is no folder. */
  skillList(cwd: string | null): Promise<SkillListResult>;
};

export type Page = {
  connection: ConnectionStore;
  sessions: Sessions;
  sessionList: SessionList;
  newSession: NewSessionFolderStore;
  drafts: Drafts;
  pulls: Pulls;
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
  const newSession = createNewSessionFolder();
  const drafts = createDrafts();
  const queryClient = createQueryClient();
  const pulls = createPulls(client);
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
    queryClient,
    queries: {
      modelList: () => client.listModels(),
      skillList: (cwd) => (cwd === null ? client.listSkills() : client.listSkills(cwd)),
    },
    router,
    actions: {
      async createSession(cwd) {
        const created = await client.createSession(cwd === null ? undefined : { cwd });
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
      async useModel(sessionId, name) {
        await client.setSessionModel(sessionId, name);
      },
      async setDefault(name) {
        await client.setDefaultModel(name);
        await queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
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
      async cancelPull(ref) {
        pulls.forget(ref);
        await client.cancelPull(ref);
      },
      async remove(ref) {
        await client.deleteModel(ref);
        await queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
      },
      async refreshModels() {
        queryClient.setQueryData(MODEL_LIST_KEY, await client.listModels(true));
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
