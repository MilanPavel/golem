import type { ApprovalChoice, GolemClient } from "@golem/client";
import type { QueryClient } from "@tanstack/react-query";
import { createDrafts, type Drafts } from "./drafts.ts";
import { createConnectionStore, type ConnectionStore } from "./connection.ts";
import { createNewSessionFolder, type NewSessionFolderStore } from "./new-session.ts";
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
  | "respondApproval"
  | "checkNow"
  | "close"
>;

/** Thin calls on the client. Their results arrive as events, so there is nothing to merge. */
export type PageActions = {
  createSession(cwd: string | null): Promise<string>;
  send(sessionId: string, text: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  /** Sets the title. What the page shows afterwards comes from the daemon's summary. */
  rename(sessionId: string, title: string): Promise<void>;
  /** Forks at a message and resolves with the new session's id. */
  fork(sessionId: string, atMessageId: string): Promise<string>;
  close(sessionId: string): Promise<void>;
  respond(sessionId: string, callId: string, decision: ApprovalChoice, args?: Readonly<Record<string, unknown>>): Promise<void>;
};

export type Page = {
  connection: ConnectionStore;
  sessions: Sessions;
  sessionList: SessionList;
  newSession: NewSessionFolderStore;
  drafts: Drafts;
  queryClient: QueryClient;
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
    queryClient,
    router,
    actions: {
      async createSession(cwd) {
        const created = await client.createSession(cwd === null ? undefined : { cwd });
        return created.session_id;
      },
      async send(sessionId, text) {
        await client.sendMessage(sessionId, text);
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
      stopQueries = keepQueriesHonest(client, queryClient);
      doc.addEventListener("visibilitychange", onVisibility);
    },
    stop() {
      started = false;
      doc.removeEventListener("visibilitychange", onVisibility);
      stopQueries?.();
      stopQueries = undefined;
      sessionList.stop();
      sessions.stop();
      router.stop();
      queryClient.clear();
      connection.stop();
    },
  };
}
