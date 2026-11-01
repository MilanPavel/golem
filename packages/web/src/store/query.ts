import type { GolemClient } from "@golem/client";
import { QueryClient } from "@tanstack/react-query";

export type QueryWiringClient = Pick<
  GolemClient,
  "state" | "onState" | "onEvent" | "onSessionSummary" | "onSkillsChanged" | "onMcpStatus" | "onPull"
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
  let wasConnected = client.state.status === "connected";
  const offs = [
    client.onSkillsChanged(() => {
      stale("skill.list");
    }),
    client.onMcpStatus(() => {
      stale("mcp.list");
      stale("mcp.tools");
    }),
    client.onPull((update) => {
      if (update.kind === "done") {
        stale("model.list");
      }
    }),
    client.onEvent((event) => {
      if (event.type === "session.updated") {
        stale("session.inspect", event.session_id);
      }
    }),
    client.onSessionSummary((summary) => {
      stale("session.inspect", summary.session_id);
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
  };
}
