import { MEMORY_GROUPS } from "@golem/view";
import { useId } from "react";
import { scopeMayGoToPaid, type MemoryCounts, type MemoryExportParams, type MemoryItem, type MemoryPrivacy, type MemoryScope, type MemorySettings } from "../../../store/memory.ts";
import { Button } from "../../../ui/button.tsx";
import { Input } from "../../../ui/input.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/tabs.tsx";
import { MemoryRow, type MemoryRowActions } from "./memory-row.tsx";
import { MemorySwitch } from "./memory-switch.tsx";

const SCOPES: readonly MemoryScope[] = ["you", "project", "history"];

export const EMPTY_TEXT = 'Nothing remembered yet. Say "remember that …" in a chat.';
export const NO_MATCH_TEXT = "No memory matches.";
const SCOPE_HINT: Record<MemoryScope, string> = {
  you: "Preferences and facts about you.",
  project: "Conventions and notes about the code.",
  history: "One searchable summary per session, helpers' answers included.",
};

/** What the page can say instead of a list. */
export type MemoryNotice = { kind: "loading" } | { kind: "off"; text: string } | { kind: "error"; text: string };

export type MemoryViewProps = {
  notice: MemoryNotice | null;
  scope: MemoryScope;
  onScope: (scope: MemoryScope) => void;
  query: string;
  onQuery: (query: string) => void;
  counts: MemoryCounts | undefined;
  settings: MemorySettings | undefined;
  items: readonly MemoryItem[];
  /** The tab's rows are being read: show that, not the empty text. */
  listLoading: boolean;
  total: number;
  onMore: (() => void) | null;
  rowActions: MemoryRowActions;
  onScopePrivacy: (scope: MemoryScope, privacy: MemoryPrivacy) => Promise<void>;
  onExport: (format: MemoryExportParams["format"]) => Promise<void>;
  /** A failure of a scope-wide control, shown above the list. */
  problem: string | null;
};

function Toolbar({ scope, settings, onScopePrivacy, onExport, disabled }: Pick<MemoryViewProps, "scope" | "settings" | "onScopePrivacy" | "onExport"> & { disabled: boolean }) {
  const mayGo = scopeMayGoToPaid(settings, scope);
  const labelId = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex items-center gap-2 text-sm text-ink">
        <MemorySwitch checked={mayGo} labelledBy={labelId} onToggle={() => void onScopePrivacy(scope, mayGo ? "local" : "chat")} />
        <span id={labelId}>May be sent to a paid model</span>
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Button size="sm" disabled={disabled} onClick={() => void onExport("markdown")}>
          Export Markdown
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => void onExport("json")}>
          Export JSON
        </Button>
      </span>
    </div>
  );
}

/** Settings › Memory: a search box, the tabs You, This project and History, and the rows of the tab. */
export function MemoryView(props: MemoryViewProps) {
  const { notice, scope, onScope, query, onQuery, counts, settings, items, total, onMore, rowActions } = props;
  if (notice !== null && notice.kind !== "loading") {
    return (
      <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "text-sm text-deny" : "text-sm text-muted"}>
        {notice.text}
      </p>
    );
  }
  if (notice !== null) return <p className="font-mono text-sm text-muted">asking the daemon…</p>;
  return (
    <div className="flex max-w-column flex-col gap-4">
      <Input type="search" aria-label="Search memory" placeholder="Search memory" value={query} onChange={(event) => onQuery(event.target.value)} />
      <Tabs value={scope} onValueChange={(next) => onScope(next as MemoryScope)} className="flex flex-col gap-3">
        <TabsList aria-label="Memory scopes">
          {SCOPES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {MEMORY_GROUPS[value]}{" "}
              <span className="ml-1 font-mono text-xs text-faint">{counts?.[value] ?? 0}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {SCOPES.map((value) => (
          <TabsContent key={value} value={value} className="flex flex-col gap-3">
            <p className="text-sm text-muted">{SCOPE_HINT[value]}</p>
            <Toolbar scope={value} settings={settings} onScopePrivacy={props.onScopePrivacy} onExport={props.onExport} disabled={total === 0} />
            {props.problem === null ? null : (
              <p role="alert" className="text-sm text-deny">
                {props.problem}
              </p>
            )}
            {props.listLoading ? (
              <p className="font-mono text-sm text-muted">asking the daemon…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted">{query === "" ? EMPTY_TEXT : NO_MATCH_TEXT}</p>
            ) : (
              <>
                <p className="font-mono text-xs text-faint">{items.length === total ? `${total} shown` : `${items.length} of ${total} shown`}</p>
                <ul className="flex flex-col gap-2">
                  {items.map((item) => (
                    <MemoryRow key={item.id} item={item} actions={rowActions} />
                  ))}
                </ul>
                {onMore === null ? null : (
                  <div>
                    <Button size="sm" onClick={onMore}>
                      Show more
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
