import { keepPreviousData, QueryClientProvider, useInfiniteQuery, useQuery, type UseInfiniteQueryResult, type InfiniteData, type UseQueryResult } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { ConnectionProvider } from "./connection-context.tsx";
import { changeDiffKey, changesDiffKey, changesListKey, commitInfoKey, type ChangedFiles, type ChangesCommitInfoResult, type FileDiff } from "./changes.ts";
import { fileListKey, fileReadKey, type FileRead } from "./files.ts";
import { configKey, type ConfigGetResult } from "./config.ts";
import { AGENTS_KEEP_KEY, NOTIFICATIONS_KEY, type AgentsKeepValues } from "./notifications.ts";
import { DEVICE_LIST_KEY, type DeviceListResult, type PairingSnapshot } from "./devices.ts";
import { memoryListKey, type MemoryListResult, type MemoryScope } from "./memory.ts";
import { ROUTING_KEY } from "./routing.ts";
import { KEYS_KEY } from "./keys.ts";
import type { FsListDirsResult } from "./dirs.ts";
import { MODEL_LIST_ALL_KEY, MODEL_LIST_KEY, SETUP_STATUS_KEY, type ModelListResult } from "./models.ts";
import type { Page, PageActions } from "./page.ts";
import type { AppInstallSnapshot } from "./app-install.ts";
import type { PageHostSnapshot } from "./page-host.ts";
import type { PullsSnapshot } from "./pulls.ts";
import type { Route } from "./router.ts";
import type { AuthListResult, FileListResult, CostGetResult, NotificationsValues, RoutingGetResult, McpListResult, SessionSummary, SetupStatusResult, SkillListResult, AgentsListResult } from "@golem/client";
import { isAgentsMissing } from "./agents.ts";
import { ARTIFACT_PAGE, artifactKey, traceKey, traceSpanKey, type ArtifactReadResult, type TraceGetResult, type TraceSpanResult } from "./trace.ts";
import { ROUTINE_LIST_KEY, routineGetKey, type RoutineGetResult, type RoutineListResult } from "./routines.ts";
import { RUN_LIST_KEY, sessionRunKey, type RunInfo, type RunListResult } from "./runs.ts";
import { mcpCatalogKey, mcpListKey, mcpToolsKey, type McpCatalogResult, type McpToolsResult } from "./mcp.ts";
import { turnCards, type NotesState, type Pastes, type ReviewNote, type ShellTracking, type TurnCard } from "@golem/view";
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

/** Whether a job keeps the gateway running. Unknown until `/healthz` answers. */
export function usePageHost(): PageHostSnapshot {
  const { pageHost } = usePage();
  return useSyncExternalStore(pageHost.subscribe, pageHost.getSnapshot);
}

/** Whether the page can become an app, and the action that fires the browser's install prompt. */
export function useAppInstall(): { snapshot: AppInstallSnapshot; install: () => Promise<void> } {
  const { appInstall } = usePage();
  const snapshot = useSyncExternalStore(appInstall.subscribe, appInstall.getSnapshot);
  return { snapshot, install: appInstall.install };
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

/** A session's review notes, and what changes them. */
export function useNotes(sessionId: string): {
  state: NotesState;
  add: (note: Omit<ReviewNote, "id">) => void;
  edit: (id: string, text: string) => void;
  remove: (id: string) => void;
  drop: (ids: readonly string[]) => void;
  clear: () => void;
} {
  const { notes } = usePage();
  const state = useSyncExternalStore(notes.subscribe, () => notes.get(sessionId));
  return {
    state,
    add: useCallback((note) => notes.add(sessionId, note), [notes, sessionId]),
    edit: useCallback((id, text) => notes.edit(sessionId, id, text), [notes, sessionId]),
    remove: useCallback((id) => notes.remove(sessionId, id), [notes, sessionId]),
    drop: useCallback((ids) => notes.drop(sessionId, ids), [notes, sessionId]),
    clear: useCallback(() => notes.clear(sessionId), [notes, sessionId]),
  };
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

/**
 * Where each provider's key is kept (`auth.list`, never a key). A key set in a terminal pushes no event, so
 * the answer is read again whenever the tab is seen, and whenever Settings asks.
 */
export function useKeys(enabled = true): UseQueryResult<AuthListResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: [...KEYS_KEY], queryFn: queries.keys, enabled, staleTime: 0, refetchOnWindowFocus: true });
}

/** What model calls cost. Read again whenever Settings opens and the tab is seen: nothing pushes a change. */
export function useCost(enabled = true, sessionId?: string): UseQueryResult<CostGetResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: ["cost.get", sessionId ?? null], queryFn: () => queries.cost(sessionId), enabled, staleTime: 0, retry: false, refetchOnWindowFocus: true });
}

/** The routing, budget and context settings. Read again whenever the tab is seen: a terminal edit pushes nothing. */
export function useRouting(enabled = true): UseQueryResult<RoutingGetResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: [...ROUTING_KEY], queryFn: queries.routing, enabled, staleTime: 0, retry: false, refetchOnWindowFocus: true });
}

/** How long a finished helper's steps are kept. Read again whenever the tab is seen: a terminal edit pushes nothing. */
export function useAgentsKeep(enabled = true): UseQueryResult<AgentsKeepValues> {
  const { queries } = usePage();
  return useQuery({ queryKey: [...AGENTS_KEEP_KEY], queryFn: queries.agentsKeep, enabled, staleTime: 0, retry: false, refetchOnWindowFocus: true });
}

/** The `[notifications]` settings. Read again whenever the tab is seen: a terminal edit pushes nothing. */
export function useNotifications(enabled = true): UseQueryResult<NotificationsValues> {
  const { queries } = usePage();
  return useQuery({ queryKey: [...NOTIFICATIONS_KEY], queryFn: queries.notifications, enabled, staleTime: 0, retry: false, refetchOnWindowFocus: true });
}

/** The skills a folder sees (all of them for null). Fetched only once `enabled`, and again after a skills change. */
export function useSkillList(cwd: string | null, enabled = true): UseQueryResult<SkillListResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: ["skill.list", cwd], queryFn: () => queries.skillList(cwd), enabled });
}

/** The agent types a folder sees (the user's and golem's for null), and again after an agents change. An older daemon is not retried. */
export function useAgentList(cwd: string | null, enabled = true): UseQueryResult<AgentsListResult> {
  const { queries } = usePage();
  return useQuery({
    queryKey: ["agents.list", cwd],
    queryFn: () => queries.agentList(cwd),
    enabled,
    retry: (count, error) => !isAgentsMissing(error) && count < 1,
  });
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

/** The files a session changed. Read when first used, and again after a `file.changed` event. */
export function useChangedFiles(sessionId: string): ChangedFiles {
  const { queries } = usePage();
  const result = useQuery({
    queryKey: changesListKey(sessionId),
    queryFn: () => queries.changesList(sessionId),
  });
  return { files: result.data?.files ?? null, error: result.error === null ? null : result.error.message };
}

/** How the session finds the files its shell commands change. Shares the read of `useChangedFiles`. */
export function useShellTracking(sessionId: string): ShellTracking {
  const { queries } = usePage();
  const result = useQuery({
    queryKey: changesListKey(sessionId),
    queryFn: () => queries.changesList(sessionId),
  });
  return result.data?.shell ?? "git";
}

/** What git says about the session folder: whether it is a repository, its branch, and the changed paths it sees. */
export function useCommitInfo(sessionId: string): ChangesCommitInfoResult | null {
  const { queries } = usePage();
  const result = useQuery({
    queryKey: commitInfoKey(sessionId),
    queryFn: () => queries.changesCommitInfo(sessionId),
    retry: false,
  });
  return result.data ?? null;
}

/** One file's diff. Not read for a null path. */
export function useFileDiff(sessionId: string, path: string | null): FileDiff {
  const { queries } = usePage();
  const result = useQuery({
    queryKey: changesDiffKey(sessionId, path ?? ""),
    queryFn: () => queries.changesDiff(sessionId, { path: path ?? "" }),
    enabled: path !== null,
  });
  return {
    diff: result.data?.diff ?? null,
    truncated: result.data?.truncated ?? false,
    error: result.error === null ? null : result.error.message,
  };
}

/** The paths of the session's folder that hold `query`, at most `limit`; dot files only when `hidden`. The last answer stays while a new one is read. */
export function useFileList(sessionId: string, query: string, limit: number, hidden: boolean): UseQueryResult<FileListResult> {
  const { queries } = usePage();
  return useQuery({
    queryKey: fileListKey(sessionId, query, hidden),
    queryFn: () => queries.listFiles(sessionId, query, limit, hidden),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** The start of one file of the session's folder. Not read for a null path; read again after `file.changed`. */
export function useFileRead(sessionId: string, path: string | null): FileRead {
  const { queries } = usePage();
  const result = useQuery({
    queryKey: fileReadKey(sessionId, path ?? ""),
    queryFn: () => queries.readFile(sessionId, path ?? ""),
    enabled: path !== null,
    retry: false,
  });
  return { file: result.data ?? null, error: result.error === null ? null : result.error.message };
}

/** The diff of one change, as one turn made it. Not read for a null id. */
export function useChangeDiff(sessionId: string, changeId: string | null): FileDiff {
  const { queries } = usePage();
  const result = useQuery({
    queryKey: changeDiffKey(sessionId, changeId ?? ""),
    queryFn: () => queries.changesDiff(sessionId, { changeId: changeId ?? "" }),
    enabled: changeId !== null,
  });
  return {
    diff: result.data?.diff ?? null,
    truncated: result.data?.truncated ?? false,
    error: result.error === null ? null : result.error.message,
  };
}

/** The turns of a session that changed files, newest first, from the session store. */
export function useTurnCards(sessionId: string): TurnCard[] {
  const changes = useSession(sessionId, (view) => view.changes);
  const messages = useSession(sessionId, (view) => view.chat.messages);
  return useMemo(() => turnCards(changes, messages), [changes, messages]);
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

/**
 * A scope's memories, a page at a time, matching `query` when it is not empty. A pushed `memory.changed`
 * and every memory action read the loaded pages again.
 */
export function useMemoryList(scope: MemoryScope, query: string): UseInfiniteQueryResult<InfiniteData<MemoryListResult, string | null>> {
  const { queries } = usePage();
  return useInfiniteQuery({
    queryKey: memoryListKey(scope, query),
    queryFn: ({ pageParam }) => queries.memoryList({ scope, query, after: pageParam }),
    initialPageParam: null as string | null,
    // The counts and settings of the last answer stay on screen while another tab or search is read.
    placeholderData: keepPreviousData,
    getNextPageParam: (last, pages) => (pages.reduce((count, page) => count + page.items.length, 0) < last.total ? (last.items.at(-1)?.id ?? null) : null),
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

/** Every paired phone, revoked ones last. Marked stale by the pushed `device.changed` and by the actions. */
export function useDeviceList(): UseQueryResult<DeviceListResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: [...DEVICE_LIST_KEY], queryFn: queries.deviceList, retry: false });
}

/** The pairing of a phone this page opened, and what to do with it. */
export function usePairing(): { snapshot: PairingSnapshot; begin(): Promise<void>; confirm(accept: boolean): Promise<void>; cancel(): void; dismiss(): void } {
  const { pairing } = usePage();
  const snapshot = useSyncExternalStore(pairing.subscribe, pairing.getSnapshot);
  return { snapshot, begin: pairing.begin, confirm: pairing.confirm, cancel: pairing.cancel, dismiss: pairing.dismiss };
}

/** The routines, with each one's next and last run. Marked stale by the pushed `routine.*` notifications. */
export function useRoutineList(): UseQueryResult<RoutineListResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: [...ROUTINE_LIST_KEY], queryFn: queries.routineList, retry: false });
}

/** One routine with its recent runs. Marked stale by the same notifications, so a firing shows in its History. */
export function useRoutine(name: string, folder: string | null): UseQueryResult<RoutineGetResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: routineGetKey(name, folder), queryFn: () => queries.routineGet(name, folder), retry: false });
}

/** The runs, one per headless session, newest first. Marked stale when a routine fires or ends and when a headless session changes. */
export function useRunList(): UseQueryResult<RunListResult> {
  const { queries } = usePage();
  return useQuery({ queryKey: [...RUN_LIST_KEY], queryFn: () => queries.runList(null), retry: false });
}

/** The run row of one session: null when the session is not headless (or the daemon cannot say), undefined while it loads. */
export function useSessionRun(sessionId: string): RunInfo | null | undefined {
  const { queries } = usePage();
  const query = useQuery({ queryKey: sessionRunKey(sessionId), queryFn: () => queries.runList(sessionId), retry: false });
  if (query.data === undefined) return query.isError ? null : undefined;
  return query.data.runs[0] ?? null;
}
