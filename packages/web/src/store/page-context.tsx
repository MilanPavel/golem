import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { ConnectionProvider } from "./connection-context.tsx";
import type { Page, PageActions } from "./page.ts";
import type { Route } from "./router.ts";
import type { SessionSummary } from "@golem/client";
import { distinctFolders, resolveFolder } from "./new-session.ts";
import { initialSessionView, type SessionView } from "./session-store.ts";

const PageContext = createContext<Page | null>(null);

/** Puts the page's stores, query client, and router in context. */
export function PageProvider({ page, children }: { page: Page; children: ReactNode }) {
  return (
    <PageContext.Provider value={page}>
      <QueryClientProvider client={page.queryClient}>
        <ConnectionProvider source={page.connection}>{children}</ConnectionProvider>
      </QueryClientProvider>
    </PageContext.Provider>
  );
}

function usePage(): Page {
  const page = useContext(PageContext);
  if (!page) {
    throw new Error("This hook needs a PageProvider above it.");
  }
  return page;
}

export function useRoute(): Route {
  const { router } = usePage();
  return useSyncExternalStore(router.subscribe, router.getSnapshot);
}

export function useNavigate(): (path: string, options?: { replace?: boolean }) => void {
  return usePage().router.navigate;
}

/** The live session list, newest activity first. */
export function useSessionList(): readonly SessionSummary[] {
  const { sessionList } = usePage();
  return useSyncExternalStore(sessionList.subscribe, sessionList.getSnapshot);
}

/**
 * A slice of one session. The session opens when the first component uses it and closes after
 * the last one unmounts. Opening happens in `subscribe`, which React runs on mount and undoes on
 * unmount, so a render that never commits attaches nothing.
 */
export function useSession<T>(id: string, selector: (view: SessionView) => T, isEqual?: (a: T, b: T) => boolean): T {
  const page = usePage();
  const subscribe = useCallback(
    (listener: () => void) => {
      const { store, release } = page.acquire(id);
      const off = store.subscribe(listener);
      return () => {
        off();
        release();
      };
    },
    [page, id],
  );
  const getSnapshot = useCallback(
    () => page.sessions.get(id)?.getSnapshot() ?? initialSessionView,
    [page, id],
  );
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, selector, isEqual);
}

export function usePageActions(): PageActions {
  return usePage().actions;
}

/** The folder the next new session gets, and a setter for it (null for no folder). */
export function useNewSessionFolder(): [string | null, (folder: string | null) => void] {
  const { newSession, sessionList } = usePage();
  const state = useSyncExternalStore(newSession.subscribe, newSession.getSnapshot);
  const list = useSyncExternalStore(sessionList.subscribe, sessionList.getSnapshot);
  return [resolveFolder(state, list), newSession.choose];
}

/** The folders to offer for a new session, newest first. */
export function useKnownFolders(): string[] {
  const list = useSessionList();
  return distinctFolders(list);
}

/** Tells the page which folder the session in view runs in, so the next new session starts there. */
export function useRememberOpenedFolder(): (cwd: string | null) => void {
  return usePage().newSession.opened;
}
