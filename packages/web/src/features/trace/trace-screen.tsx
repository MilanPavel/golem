import type { UseQueryResult } from "@tanstack/react-query";
import type { TraceGetResult, TraceRunSpan, TraceSpanResult } from "../../store/trace.ts";
import { useNavigate, useTrace, useTraceSpan } from "../../store/page-context.tsx";
import { sessionPath, tracePath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { RefreshIcon } from "../../ui/icons.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { Link } from "../../ui/link.tsx";
import { SpanDetail } from "./span-detail.tsx";
import { TraceSummary } from "./trace-summary.tsx";
import { TraceTree } from "./trace-tree.tsx";
import { useNarrow } from "./use-narrow.ts";

export const SELECT_A_SPAN = "Select a span to see what went in and what came out.";
export const NOTHING_TO_TRACE = "Nothing to trace yet. Send a message first.";

/** The full page's header: a way back to the chat, and Refresh, then the summary line. */
function Header({ id, runs, refreshing, onRefresh }: { id: string; runs: readonly TraceRunSpan[] | null; refreshing: boolean; onRefresh: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-1.5">
        <Link href={sessionPath(id)} onNavigate={navigate} className="text-sm text-clay-ink underline underline-offset-2">
          Back to chat
        </Link>
        <h2 className="text-sm font-medium">Trace</h2>
        <div className="flex-1" />
        <Button kind="ghost" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh">
          <RefreshIcon className="size-3.5" />
          <span className="max-narrow:hidden">Refresh</span>
        </Button>
      </div>
      {runs === null || runs.length === 0 ? null : (
        <div className="flex items-center border-b border-line px-4 py-1.5">
          <TraceSummary runs={runs} />
        </div>
      )}
    </div>
  );
}

function Empty({ id, back }: { id: string; back: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="grid flex-1 place-items-center p-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-muted">{NOTHING_TO_TRACE}</p>
        {back ? (
          <Link href={sessionPath(id)} onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
            Back to the chat
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** The span's input and output, or why there are none yet. */
function Detail({ id, span, query }: { id: string; span: string | null; query: UseQueryResult<TraceSpanResult> }) {
  if (span === null) return <p className="m-auto p-5 text-center text-sm text-faint">{SELECT_A_SPAN}</p>;
  if (query.isPending) {
    return (
      <p role="status" className="p-5 text-sm text-muted">
        Reading the span…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-5">
        <p className="text-sm text-deny">{query.error.message}</p>
        <Button size="sm" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <SpanDetail result={query.data} sessionId={id} />;
}

/** `split` puts the detail beside the tree, as the full page does; `stacked` puts it under the tree, for a narrow column. */
export type TraceLayout = "split" | "stacked";

type PanesProps = {
  id: string;
  trace: TraceGetResult;
  span: string | null;
  query: UseQueryResult<TraceSpanResult>;
  layout: TraceLayout;
  onSelect: (span: string | null) => void;
};

function Panes({ id, trace, span, query, layout, onSelect }: PanesProps) {
  const narrow = useNarrow();
  if (trace.runs.length === 0) return <Empty id={id} back={layout === "split"} />;
  if (layout === "stacked") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col">
          <TraceTree runs={trace.runs} selected={span} onSelect={onSelect} compact />
        </div>
        <section aria-label="Span detail" className="flex min-h-0 flex-1 basis-1/2 flex-col border-t border-line">
          <Detail id={id} span={span} query={query} />
        </section>
      </div>
    );
  }
  const close = () => onSelect(null);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 w-11/20 min-w-0 flex-col border-r border-line max-narrow:w-full max-narrow:border-r-0">
        <TraceTree runs={trace.runs} selected={span} onSelect={onSelect} />
      </div>
      {narrow ? (
        // On a narrow window the span opens as a sheet over the tree. Closing it clears ?span=.
        <Dialog open={span !== null} onOpenChange={(open) => !open && close()}>
          <DialogContent className="flex h-full max-h-full max-w-none flex-col overflow-hidden p-0">
            <DialogTitle className="sr-only">Span</DialogTitle>
            <DialogDescription className="sr-only">What the selected span took in and gave out.</DialogDescription>
            <div className="flex justify-end border-b border-line px-3 py-1.5">
              <Button kind="ghost" size="sm" aria-label="Close span" onClick={close}>
                Close
              </Button>
            </div>
            <Detail id={id} span={span} query={query} />
          </DialogContent>
        </Dialog>
      ) : (
        <section aria-label="Span detail" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Detail id={id} span={span} query={query} />
        </section>
      )}
    </div>
  );
}

/** What the trace page and the inspector share: the trace and the selected span's detail, and a refresh for both. */
export function useTraceData(id: string, span: string | null) {
  const trace = useTrace(id);
  const detail = useTraceSpan(id, span);
  return {
    trace,
    detail,
    refreshing: trace.isFetching || detail.isFetching,
    refresh() {
      void trace.refetch();
      if (span !== null) void detail.refetch();
    },
  };
}

export type TraceData = ReturnType<typeof useTraceData>;

/** The trace itself: its read pending or failed, or the tree and the span detail. */
export function TraceBody({ id, span, data, layout, onSelect }: { id: string; span: string | null; data: TraceData; layout: TraceLayout; onSelect: (span: string | null) => void }) {
  const { trace, detail } = data;
  if (trace.isPending) {
    return (
      <p role="status" className="p-5 text-sm text-muted">
        Reading the trace…
      </p>
    );
  }
  if (trace.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-5">
        <p className="text-sm text-deny">{trace.error.message}</p>
        <Button size="sm" onClick={() => void trace.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <Panes id={id} trace={trace.data} span={span} query={detail} layout={layout} onSelect={onSelect} />;
}

/** A session's trace page, below the session's top bar: the way back, the summary line, the tree with its waterfall, and the detail beside it. */
export function TraceScreen({ id, span }: { id: string; span: string | null }) {
  const navigate = useNavigate();
  const data = useTraceData(id, span);
  return (
    <div data-screen="trace" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Header id={id} runs={data.trace.data?.runs ?? null} refreshing={data.refreshing} onRefresh={data.refresh} />
      <TraceBody id={id} span={span} data={data} layout="split" onSelect={(next) => navigate(tracePath(id, next), { replace: true })} />
    </div>
  );
}
