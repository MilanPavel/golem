import { useRef } from "react";
import { useNavigate } from "../../store/page-context.tsx";
import { inspectPath, tracePath } from "../../store/router.ts";
import { cn } from "../../ui/cn.ts";
import { HEADER_ROW } from "../../ui/header-row.ts";
import { CloseIcon, RefreshIcon } from "../../ui/icons.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { Link } from "../../ui/link.tsx";
import { ResizeHandle } from "../../ui/resize-handle.tsx";
import { INSPECTOR_DEFAULT, INSPECTOR_MAX, INSPECTOR_MIN, INSPECTOR_STEP, useInspectorWidth } from "./inspector-width.ts";
import { TraceBody, useTraceData } from "./trace-screen.tsx";
import { TraceSummary } from "./trace-summary.tsx";
import { useNarrow } from "./use-narrow.ts";

export const INSPECTOR_ID = "trace-inspector";

/**
 * The trace beside the chat. It reads the same trace and span detail as the full page and shows
 * them with the same tree and detail, the detail stacked under the tree to fit the column. Its
 * state is the address: `?inspect=<span>` selects a span, and Close drops the parameter. Below
 * the narrow breakpoint it covers the chat instead of sitting beside it.
 */
export function InspectorPanel({ id, span, onClose }: { id: string; span: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const narrow = useNarrow();
  const [width, setWidth] = useInspectorWidth();
  const panel = useRef<HTMLElement>(null);
  const data = useTraceData(id, span);
  const runs = data.trace.data?.runs ?? [];
  return (
    <aside
      ref={panel}
      id={INSPECTOR_ID}
      aria-label="Trace inspector"
      data-narrow={narrow ? "" : undefined}
      onKeyDown={(event) => {
        // Not for a key that came through a dialog's portal, which Radix closes on its own.
        if (event.key === "Escape" && !event.defaultPrevented && event.currentTarget.contains(event.target as Node)) onClose();
      }}
      style={width === INSPECTOR_DEFAULT ? undefined : { width: `${width}rem` }}
      className="relative flex min-h-0 w-inspector max-w-3/5 min-w-inspector-min flex-none flex-col border-l border-line bg-surface max-narrow:fixed max-narrow:inset-0 max-narrow:z-20 max-narrow:w-full max-narrow:max-w-none max-narrow:border-l-0"
    >
      <ResizeHandle
        width={width}
        min={INSPECTOR_MIN}
        max={INSPECTOR_MAX}
        step={INSPECTOR_STEP}
        label="Resize the inspector"
        onResize={setWidth}
        panel={panel}
        className="max-narrow:hidden"
      />
      <div className={cn(HEADER_ROW, "gap-1 px-3 py-2")}>
        <h2 className="text-sm font-medium">Trace</h2>
        <div className="flex-1" />
        <Link href={tracePath(id, span)} onNavigate={navigate} className="px-1.5 text-xs text-clay-ink underline underline-offset-2">
          Open full ↗
        </Link>
        <IconButton label="Refresh" disabled={data.refreshing} onClick={data.refresh}>
          <RefreshIcon className="size-3.5" />
        </IconButton>
        <IconButton label="Close inspector" aria-controls={INSPECTOR_ID} onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
      {runs.length === 0 ? null : (
        <div className="flex items-center border-b border-line px-3 py-1.5">
          <TraceSummary runs={runs} events={data.trace.data?.context_events ?? []} stacked />
        </div>
      )}
      <TraceBody id={id} span={span} data={data} layout="stacked" onSelect={(next) => navigate(inspectPath(id, next), { replace: true })} />
    </aside>
  );
}
