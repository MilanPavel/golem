import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useNavigate } from "../../store/page-context.tsx";
import { inspectPath, tracePath } from "../../store/router.ts";
import { CloseIcon, RefreshIcon } from "../../ui/icons.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { Link } from "../../ui/link.tsx";
import { INSPECTOR_DEFAULT, INSPECTOR_MAX, INSPECTOR_MIN, INSPECTOR_STEP, useInspectorWidth } from "./inspector-width.ts";
import { TraceBody, useTraceData } from "./trace-screen.tsx";
import { TraceSummary } from "./trace-summary.tsx";
import { useNarrow } from "./use-narrow.ts";

export const INSPECTOR_ID = "trace-inspector";

/** The drag handle between the chat and the panel. Dragging left widens the panel. */
function ResizeHandle({ width, onResize, panel }: { width: number; onResize: (rem: number) => void; panel: RefObject<HTMLElement | null> }) {
  const dragging = useRef(false);

  function drag(event: PointerEvent<HTMLDivElement>): void {
    if (!dragging.current) return;
    const right = panel.current?.getBoundingClientRect().right;
    if (right === undefined) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    onResize((right - event.clientX) / rem);
  }

  function key(event: KeyboardEvent<HTMLDivElement>): void {
    const to =
      event.key === "ArrowLeft" ? width + INSPECTOR_STEP
      : event.key === "ArrowRight" ? width - INSPECTOR_STEP
      : event.key === "Home" ? INSPECTOR_MIN
      : event.key === "End" ? INSPECTOR_MAX
      : null;
    if (to === null) return;
    event.preventDefault();
    onResize(to);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the inspector"
      aria-valuemin={INSPECTOR_MIN}
      aria-valuemax={INSPECTOR_MAX}
      aria-valuenow={width}
      aria-valuetext={`${width} rem wide`}
      tabIndex={0}
      onKeyDown={key}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={drag}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      className="absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none outline-offset-0 outline-clay hover:bg-clay/30 focus-visible:bg-clay/30 focus-visible:outline-2 max-narrow:hidden"
    />
  );
}

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
      <ResizeHandle width={width} onResize={setWidth} panel={panel} />
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
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
          <TraceSummary runs={runs} stacked />
        </div>
      )}
      <TraceBody id={id} span={span} data={data} layout="stacked" onSelect={(next) => navigate(inspectPath(id, next), { replace: true })} />
    </aside>
  );
}
