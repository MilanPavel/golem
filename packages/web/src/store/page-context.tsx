import { keepPreviousData, QueryClientProvider, useInfiniteQuery, useQuery, type UseInfiniteQueryResult, type InfiniteData, type UseQueryResult } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { ConnectionProvider } from "./connection-context.tsx";
import { configKey, type ConfigGetResult } from "./config.ts";
import type { FsListDirsResult } from "./dirs.ts";
import { MODEL_LIST_ALL_KEY, MODEL_LIST_KEY, SETUP_STATUS_KEY, type ModelListResult } from "./models.ts";
import type { Page, PageActions } from "./page.ts";
import type { PullsSnapshot } from "./pulls.ts";
import type { Route } from "./router.ts";
import type { McpListResult, SessionSummary, SetupStatusResult, SkillListResult } from "@golem/client";
import { ARTIFACT_PAGE, artifactKey, traceKey, traceSpanKey, type ArtifactReadResult, type TraceGetResult, type TraceSpanResult } from "./trace.ts";
import { mcpCatalogKey, mcpListKey, mcpToolsKey, type McpCatalogResult, type McpToolsResult } from "./mcp.ts";
import type { Pastes } from "@golem/view";
import { distinctFolders, resolveFolder } from "./new-session.ts";
import type { SetupStart } from "./setup-start.ts";
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
  return useSessionSlice(id, selector, isEqual);
}

/** Like {@link useSession}, for a session that may not exist yet: with null it attaches nothing and reads the empty view. */
export function useSessionSlice<T>(id: string | null, selector: (view: SessionView) => T, isEqual?: (a: T, b: T) => boolean): T {
  const page = usePage();
  const subscribe = useCallback(
    (listener: () => void) => {
      if (id === null) return () => undefined;
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
    () => (id === null ? initialSessionView : (page.sessions.get(id)?.getSnapshot() ?? initialSessionView)),
    [page, id],
  );
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, selector, isEqual);
}

const NO_OPTIONS: Readonly<Record<string, number | string>> = {};
const NEVER = () => () => undefined;

/** The session's option overrides, as the newest `model.options.changed` says them. Empty with no session. */
export function useSessionOptions(id: string | null): Readonly<Record<string, number | string>> {
  const page = usePage();
  const subscribe = useCallback(
    (listener: () => void) => {
      if (id === null) return NEVER();
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
    () => (id === null ? NO_OPTIONS : (page.sessions.get(id)?.getSnapshot() ?? initialSessionView).chat.options),
    [page, id],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
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

/** The model picked for the next new session, or null for the default, and a setter for it. */
export function useNewSessionModel(): [string | null, (model: string | null) => void] {
  const { newSession } = usePage();
  const state = useSyncExternalStore(newSession.subscribe, newSession.getSnapshot);
  return [state.model, newSession.chooseModel];
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

/** The unsent text for a key (a session id, or "new"), kept while the page lives. */
export function useDraft(key: string): [string, (text: string) => void] {
  const { drafts } = usePage();
  const text = useSyncExternalStore(drafts.subscribe, () => drafts.get(key).text);
  const set = useCallback((next: string) => drafts.setText(key, next), [drafts, key]);
  return [text, set];
}

/** The long pastes behind the tokens in a draft. */
export function useDraftPastes(key: string): [Pastes, (pastes: Pastes) => void] {
  const { drafts } = usePage();
  const pastes = useSyncExternalStore(drafts.subscribe, () => drafts.get(key).pastes);
  const set = useCallback((next: Pastes) => drafts.setPastes(key, next), [drafts, key]);
  return [pastes, set];
}

/** Reads a session's draft text when called, without re-rendering when it changes. */
export function useDraftReader(key: string): () => string {
  const { drafts } = usePage();
  return useCallback(() => drafts.get(key).text, [drafts, key]);
}

/** The model listing: fresh until a pushed event says otherwise, shared by every user of the hook. */
export function useModelList(enabled = true, showAll = false): UseQueryResult<ModelListResult> {
  const { queries } = usePage();
  return useQuery({
    queryKey: showAll ? [...MODEL_LIST_ALL_KEY] : [...MODEL_LIST_KEY],
    queryFn: () => queries.modelList(showAll),
    // Turning show all on or off keeps the list on screen until the other one arrives.
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** The overview rows: fresh until the model list or the model server changes, shared by every user of the hook. */
export function useSetupStatus(enabled = true): UseQueryResult<SetupStatusResult> {
  const { queries } = usePage();
  // A key set in a terminal pushes no event, so this answer is looked at again whenever the tab is seen.
  return useQuery({
    queryKey: [...SETUP_STATUS_KEY],
    queryFn: queries.setupStatus,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * Reads a session's view and its list summary when called, without re-rendering when they
 * change. Null for no session (the empty screen); the view is the initial one until the session opens.
 */
export function useSessionReader(id: string | null): () => { view: SessionView; summary: SessionSummary | undefined } {
  const { sessions, sessionList } = usePage();
  return useCallback(
    () => ({
      view: (id === null ? undefined : sessions.get(id)?.getSnapshot()) ?? initialSessionView,
      summary: id === null ? undefined : sessionList.getSnapshot().find((item) => item.session_id === id),
    }),
    [sessions, sessionList, id],
  );
}

/** The skills a folder sees (all of them for null). Fetched only once `enabled`, and again after a skills change. */
export function useSkillList(cwd: string | null, enabled = true): UseQueryResult<SkillListResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: ["skill.list", cwd], queryFn: () => queries.skillList(cwd), enabled });
}

/** A session's trace, read once. It does not follow a run as it streams; the page's Refresh reads it again. */
export function useTrace(sessionId: string): UseQueryResult<TraceGetResult> {
  const { queries } = usePage();
  // Read again on every visit: the answer is only as new as its last read.
  return useQuery({ queryKey: traceKey(sessionId), queryFn: () => queries.trace(sessionId), staleTime: 0, retry: false });
}

/** One span's input and output. Fetched only with a `spanId`, and again by the page's Refresh. */
export function useTraceSpan(sessionId: string, spanId: string | null): UseQueryResult<TraceSpanResult> {
  const { queries } = usePage();
  return useQuery({
    queryKey: traceSpanKey(sessionId, spanId ?? ""),
    queryFn: () => queries.traceSpan(sessionId, spanId ?? ""),
    enabled: spanId !== null,
    retry: false,
  });
}

/** An artifact, a page of characters at a time. Fetched only once `enabled`, and `fetchNextPage` reads the next one. */
export function useArtifact(sessionId: string, artifactId: string, enabled = true): UseInfiniteQueryResult<InfiniteData<ArtifactReadResult, number>> {
  const { queries } = usePage();
  return useInfiniteQuery({
    queryKey: artifactKey(sessionId, artifactId),
    queryFn: ({ pageParam }) => queries.artifact(sessionId, artifactId, pageParam, ARTIFACT_PAGE),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.text.length < last.size ? last.offset + last.text.length : undefined),
    enabled,
    retry: false,
  });
}

/** The tool rules and what the session allows. Fetched only once `enabled`; the rule edits and `approval.resolved` refresh it. */
export function useConfig(cwd: string | null, sessionId: string | null, enabled = true): UseQueryResult<ConfigGetResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: configKey(cwd, sessionId), queryFn: () => queries.config(cwd, sessionId), enabled });
}

/** The MCP servers a session sees (`null`: the user's own). Fresh until `mcp.server.status` or an action says otherwise. */
export function useMcpList(sessionId: string | null, enabled = true): UseQueryResult<McpListResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: mcpListKey(sessionId), queryFn: () => queries.mcpList(sessionId), enabled });
}

/** One server's tools. Fetched only once `enabled`, and again after a status change. */
export function useMcpTools(name: string, sessionId: string | null, enabled = true): UseQueryResult<McpToolsResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: mcpToolsKey(name, sessionId), queryFn: () => queries.mcpTools(name, sessionId), enabled });
}

/** The servers the Add dialog offers. Fetched only once `enabled`, and again after an add, a remove, or a runtime install. */
export function useMcpCatalog(sessionId: string | null, enabled = true): UseQueryResult<McpCatalogResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: mcpCatalogKey(sessionId), queryFn: () => queries.mcpCatalog(sessionId), enabled });
}

/** The folders under `path` in the home folder (`null` is home). Fetched only once `enabled`. */
export function useDirs(path: string | null, enabled = true): UseQueryResult<FsListDirsResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: ["fs.list_dirs", path], queryFn: () => queries.dirs(path), enabled, staleTime: 0, retry: false });
}

/** The downloads in flight and the last failures, from every connection. */
export function usePulls(): PullsSnapshot {
  const { pulls } = usePage();
  return useSyncExternalStore(pulls.subscribe, pulls.getSnapshot);
}

/** Whether the page has decided what setup does at its start, kept across the shell's remounts. */
export function useSetupStart(): SetupStart {
  return usePage().setupStart;
}
