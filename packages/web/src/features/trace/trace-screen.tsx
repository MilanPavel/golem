import type { TraceGetResult } from "../../store/trace.ts";
import { useNavigate, useSessionList, useTrace } from "../../store/page-context.tsx";
import { sessionPath, tracePath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { RefreshIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { summaryLine } from "./format.ts";
import { TraceTree } from "./trace-tree.tsx";
import { ViewSwitch } from "./view-switch.tsx";

export const SELECT_A_SPAN = "Select a span to see what went in and what came out.";
export const NOTHING_TO_TRACE = "Nothing to trace yet. Send a message first.";

function Header({ id, title, summary, refreshing, onRefresh }: { id: string; title: string; summary: string | null; refreshing: boolean; onRefresh: () => void }) {
  return (
    <header className="flex flex-col border-b border-line">
      <div className="flex min-h-13 items-center gap-2.5 px-4 py-2.5">
        <h1 className="min-w-0 truncate text-base font-medium">{title}</h1>
        <div className="flex-1" />
        <ViewSwitch id={id} view="trace" />
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-1.5">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{summary ?? ""}</p>
        <Button kind="ghost" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh">
          <RefreshIcon className="size-3.5" />
          <span className="max-narrow:hidden">Refresh</span>
        </Button>
      </div>
    </header>
  );
}

function Empty({ id }: { id: string }) {
  const navigate = useNavigate();
  return (
    <div className="grid flex-1 place-items-center p-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-muted">{NOTHING_TO_TRACE}</p>
        <Link href={sessionPath(id)} onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
          Back to the chat
        </Link>
      </div>
    </div>
  );
}

function Panes({ id, trace, span }: { id: string; trace: TraceGetResult; span: string | null }) {
  const navigate = useNavigate();
  if (trace.runs.length === 0) return <Empty id={id} />;
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 w-11/20 min-w-0 flex-col border-r border-line max-narrow:w-full max-narrow:border-r-0">
        <TraceTree runs={trace.runs} selected={span} onSelect={(next) => navigate(tracePath(id, next), { replace: true })} />
      </div>
      <section aria-label="Span" className="grid min-w-0 flex-1 place-items-center p-5 max-narrow:hidden">
        <p className="text-center text-sm text-faint">{SELECT_A_SPAN}</p>
      </section>
    </div>
  );
}

/** A session's trace: the summary line, the tree with its waterfall, and the detail beside it. */
export function TraceScreen({ id, span }: { id: string; span: string | null }) {
  const trace = useTrace(id);
  const summary = useSessionList().find((session) => session.session_id === id);
  const title = trace.data?.title ?? summary?.title ?? "Untitled session";
  const line = trace.data === undefined ? null : summaryLine(trace.data.runs);
  return (
    <div data-screen="trace" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Header id={id} title={title} summary={line} refreshing={trace.isFetching} onRefresh={() => void trace.refetch()} />
      {trace.isPending ? (
        <p role="status" className="p-5 text-sm text-muted">
          Reading the trace…
        </p>
      ) : trace.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 p-5">
          <p className="text-sm text-deny">{trace.error.message}</p>
          <Button size="sm" onClick={() => void trace.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <Panes id={id} trace={trace.data} span={span} />
      )}
    </div>
  );
}
