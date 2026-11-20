import type { GolemClient } from "@golem/client";
import { QueryClient } from "@tanstack/react-query";
import { CHANGES_REFETCH_MS } from "./changes.ts";

export type QueryWiringClient = Pick<
  GolemClient,
  "state" | "onState" | "onEvent" | "onSessionSummary" | "onSkillsChanged" | "onMemoryChanged" | "onRoutinesChanged" | "onMcpStatus" | "onPull" | "onModelServer"
>;

/** Answers stay fresh until a pushed event says otherwise. Keys are `[method, ...params]`. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 },
    },
  });
}

/**
 * Pushed events mark the answers they change as stale, so an active query refetches and the rest
 * wait until they are used. Returns the unsubscribe.
 */
export function keepQueriesHonest(client: QueryWiringClient, queryClient: QueryClient): () => void {
  const stale = (...queryKey: unknown[]): void => {
    void queryClient.invalidateQueries({ queryKey });
  };
  // A burst of `file.changed` events for a session marks its three keys once.
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  const staleChanges = (sessionId: string): void => {
    if (waiting.has(sessionId)) return;
    waiting.set(
      sessionId,
      setTimeout(() => {
        waiting.delete(sessionId);
        stale("changes.list", sessionId);
        stale("changes.diff", sessionId);
        stale("file.read", sessionId);
        stale("changes.commit_info", sessionId);
      }, CHANGES_REFETCH_MS),
    );
  };
  let wasConnected = client.state.status === "connected";
  const offs = [
    client.onSkillsChanged(() => {
      stale("skill.list");
    }),
    client.onMemoryChanged(() => {
      stale("memory.list");
    }),
    client.onRoutinesChanged(() => {
      stale("routine.list");
      stale("routine.get");
      // A firing starts or ends a run.
      stale("run.list");
    }),
    client.onMcpStatus(() => {
      stale("mcp.list");
      stale("mcp.tools");
    }),
    client.onPull((update) => {
      if (update.kind === "done") {
        stale("model.list");
        stale("setup.status");
      }
    }),
    client.onModelServer(() => {
      stale("model.list");
      stale("setup.status");
    }),
    client.onEvent((event) => {
      if (event.type === "approval.resolved") {
        stale("config.get");
      }
      if (event.type === "file.changed") {
        staleChanges(event.session_id);
      }
      if (event.type === "session.updated") {
        stale("session.inspect", event.session_id);
      }
    }),
    client.onSessionSummary((summary) => {
      stale("session.inspect", summary.session_id);
      // A headless session that starts waiting or finishes changes its row. A chat of yours is not a run.
      if (summary.origin !== undefined && summary.origin !== "user") stale("run.list");
    }),
    client.onState((state) => {
      if (state.status !== "connected") {
        return;
      }
      if (wasConnected) {
        void queryClient.invalidateQueries();
      }
      wasConnected = true;
    }),
  ];
  return () => {
    for (const off of offs) {
      off();
    }
    for (const timer of waiting.values()) {
      clearTimeout(timer);
    }
    waiting.clear();
  };
}
