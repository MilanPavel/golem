import { useEffect, useMemo, useState } from "react";
import { isMemoryOff, memoryErrorText, memoryExportName, type MemoryExportParams, type MemoryPrivacy, type MemoryScope } from "../../../store/memory.ts";
import { useMemoryList, usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { MemoryView, type MemoryNotice, type MemoryViewProps } from "./memory-view.tsx";
import type { MemoryRowActions } from "./memory-row.tsx";
import { saveText } from "./save-text.ts";

/** How long typing waits before the search is sent. */
export const SEARCH_WAIT_MS = 200;

/** The view needs every prop; with memory off it draws only the notice. */
const OFF: Omit<MemoryViewProps, "notice"> = {
  scope: "you",
  onScope: () => {},
  query: "",
  onQuery: () => {},
  counts: undefined,
  settings: undefined,
  items: [],
  listLoading: false,
  total: 0,
  onMore: null,
  rowActions: { onEdit: async () => {}, onDelete: async () => {}, onAlways: async () => {}, onPrivacy: async () => {} },
  onScopePrivacy: async () => {},
  onExport: async () => {},
  problem: null,
};

/**
 * Every memory golem keeps: the tabs You, This project and History, a search box, and for each row edit,
 * delete, "in every chat" and where it may go. The list is read again when the daemon says `memory.changed`.
 */
export function MemorySection() {
  const actions = usePageActions();
  const [scope, setScope] = useState<MemoryScope>("you");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const list = useMemoryList(scope, query);
  const pages = list.data?.pages;
  const first = pages?.[0];
  const last = pages?.at(-1);
  const items = useMemo(() => (list.isPlaceholderData ? [] : (pages ?? []).flatMap((page) => page.items)), [list.isPlaceholderData, pages]);

  const rowActions = useMemo<MemoryRowActions>(
    () => ({
      onEdit: (id, text) => actions.updateMemory(id, { text }),
      onDelete: (id) => actions.deleteMemory(id),
      onAlways: (id, always) => actions.updateMemory(id, { always }),
      onPrivacy: (id, privacy) => actions.updateMemory(id, { privacy }),
    }),
    [actions],
  );

  async function onScopePrivacy(target: MemoryScope, privacy: MemoryPrivacy) {
    setProblem(null);
    try {
      await actions.setMemoryPrivacy(target, privacy);
    } catch (caught) {
      setProblem(memoryErrorText(caught, "Could not change the setting."));
    }
  }

  async function onExport(format: MemoryExportParams["format"]) {
    setProblem(null);
    try {
      const done = await actions.exportMemories({ scope, format });
      saveText(memoryExportName(scope, format), done.text, format === "json" ? "application/json" : "text/markdown");
    } catch (caught) {
      setProblem(memoryErrorText(caught, "Could not export the memories."));
    }
  }

  // Memory can be turned off while the page is open: the next read says so, and the old rows no longer apply.
  if (list.isError && isMemoryOff(list.error)) return <MemoryView {...OFF} notice={{ kind: "off", text: memoryErrorText(list.error, "") }} />;
  if (list.isError && first === undefined) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {memoryErrorText(list.error, "Could not read the memories.")}
        </p>
        <Button size="sm" onClick={() => void list.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const notice: MemoryNotice | null = first === undefined ? { kind: "loading" } : null;
  return (
    <MemoryView
      notice={notice}
      scope={scope}
      onScope={setScope}
      query={typed}
      onQuery={setTyped}
      counts={first?.counts}
      settings={first?.settings}
      items={items}
      listLoading={list.isPlaceholderData}
      total={last?.total ?? 0}
      onMore={list.hasNextPage && !list.isFetchingNextPage ? () => void list.fetchNextPage() : null}
      rowActions={rowActions}
      onScopePrivacy={onScopePrivacy}
      onExport={onExport}
      problem={problem}
    />
  );
}
