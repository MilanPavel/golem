import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { modelsOf, toolsOf, type TraceNode, type TraceRunSpan } from "../../store/trace.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { formatDuration, formatTokens, spanTokens } from "./format.ts";
import { barFor } from "./waterfall.ts";
import { WaterfallBar } from "./waterfall-bar.tsx";

export const NOT_RECORDED = "Not recorded. This session ran before golem kept traces.";

type Row = {
  span: TraceNode;
  run: TraceRunSpan;
  depth: 0 | 1 | 2;
  parent: string | null;
  hasChildren: boolean;
};

const INDENT = ["pl-0", "pl-4", "pl-8"] as const;

/** Every span, in tree order, that is not hidden inside a closed parent. */
export function visibleRows(runs: readonly TraceRunSpan[], open: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  for (const run of runs) {
    rows.push({ span: run, run, depth: 0, parent: null, hasChildren: modelsOf(run).length > 0 });
    if (!open.has(run.id)) continue;
    for (const model of modelsOf(run)) {
      rows.push({ span: model, run, depth: 1, parent: run.id, hasChildren: toolsOf(model).length > 0 });
      if (!open.has(model.id)) continue;
      for (const tool of toolsOf(model)) {
        rows.push({ span: tool, run, depth: 2, parent: model.id, hasChildren: false });
      }
    }
  }
  return rows;
}

/** Runs are folded except the last one and the one holding the selected span; model calls are open. */
export function initialOpen(runs: readonly TraceRunSpan[], selected: string | null): Set<string> {
  const open = new Set<string>();
  runs.forEach((run, index) => {
    const spans: TraceNode[] = [run, ...modelsOf(run), ...modelsOf(run).flatMap(toolsOf)];
    const holds = selected !== null && spans.some((span) => span.id === selected);
    if (index === runs.length - 1 || holds) open.add(run.id);
    for (const model of modelsOf(run)) open.add(model.id);
  });
  return open;
}

function Mark({ span }: { span: TraceNode }) {
  switch (span.status) {
    case "ok":
      return (
        <span className="text-allow">
          <span aria-hidden="true">✓</span>
          <span className="sr-only">ok</span>
        </span>
      );
    case "failed":
      return (
        <span className="text-deny">
          <span aria-hidden="true">✗</span>
          <span className="sr-only">failed</span>
        </span>
      );
    case "denied":
      return <span className="text-deny">denied</span>;
    case "cancelled":
      return <span className="text-muted">cancelled</span>;
    case "running":
      return <span className="text-wait">running</span>;
  }
}

function Glyph({ span }: { span: TraceNode }) {
  if (span.kind === "model") {
    return (
      <span aria-hidden="true" className="w-4 shrink-0 text-center text-clay">
        ◆
      </span>
    );
  }
  if (span.kind === "tool") {
    return (
      <span aria-hidden="true" className="w-4 shrink-0 text-center text-muted">
        ⚙
      </span>
    );
  }
  return null;
}

function TreeRow({
  row,
  open,
  selected,
  tabStop,
  onSelect,
  onToggle,
}: {
  row: Row;
  open: boolean;
  selected: boolean;
  tabStop: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const { span } = row;
  const tokens = span.kind === "model" ? spanTokens(span) : null;
  const unrecorded = span.kind === "model" && span.recorded === false;
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? open : undefined}
      data-span={span.id}
      tabIndex={tabStop ? 0 : -1}
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 text-sm outline-offset-0 outline-clay focus-visible:outline-2 ${
        selected ? "bg-clay-soft" : "hover:bg-sunken"
      }`}
    >
      <span className={`flex w-2/5 min-w-0 shrink-0 items-center gap-1.5 ${INDENT[row.depth]}`}>
        <span
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation();
            if (row.hasChildren) onToggle();
          }}
          className="w-3 shrink-0 text-center text-xs text-faint"
        >
          {row.hasChildren ? (open ? "▾" : "▸") : ""}
        </span>
        <Glyph span={span} />
        <span className={`truncate ${span.kind === "tool" ? "font-mono text-xs" : ""}`}>
          {span.kind === "run" ? `Run · ${span.name}` : span.name}
        </span>
        {unrecorded ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 text-xs text-faint">not recorded</span>
            </TooltipTrigger>
            <TooltipContent>{NOT_RECORDED}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <WaterfallBar span={span} bar={barFor(row.run, span)} />
      <span className="w-20 shrink-0 text-right font-mono text-xs text-muted tabular-nums">{formatDuration(span.duration_ms)}</span>
      <span className="w-12 shrink-0 text-right font-mono text-xs text-muted tabular-nums max-narrow:hidden">
        {span.kind === "model" ? (tokens === null ? "—" : formatTokens(tokens)) : ""}
      </span>
      <span className="w-16 shrink-0 text-right text-xs">
        <Mark span={span} />
      </span>
    </div>
  );
}

/**
 * The runs as a tree, with each span on its run's time line. One tab stop: arrows move, → opens a
 * row or goes to its first child, ← closes it or goes to its parent, Enter opens or closes.
 */
export function TraceTree({
  runs,
  selected,
  onSelect,
}: {
  runs: readonly TraceRunSpan[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(() => initialOpen(runs, selected));
  const rows = useMemo(() => visibleRows(runs, open), [runs, open]);
  const tree = useRef<HTMLDivElement>(null);

  // A run that arrives after a refresh is the newest one, so it opens like the last one does.
  const [seen, setSeen] = useState(runs.length);
  if (runs.length !== seen) {
    setSeen(runs.length);
    const newest = runs[runs.length - 1];
    if (runs.length > seen && newest !== undefined) {
      setOpen((now) => new Set([...now, newest.id, ...modelsOf(newest).map((model) => model.id)]));
    }
  }

  // After a move by key, focus goes with the selection.
  useEffect(() => {
    const root = tree.current;
    if (root === null || selected === null || !root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>(`[data-span="${CSS.escape(selected)}"]`)?.focus();
  }, [selected]);

  const tabId = rows.some((row) => row.span.id === selected) ? selected : (rows[0]?.span.id ?? null);

  function toggle(id: string, to?: boolean): void {
    setOpen((now) => {
      const next = new Set(now);
      if (to ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const id = (event.target as HTMLElement).closest<HTMLElement>("[role=treeitem]")?.dataset["span"];
    const at = rows.findIndex((row) => row.span.id === id);
    const row = rows[at];
    if (row === undefined) return;
    let go: Row | undefined;
    switch (event.key) {
      case "ArrowDown":
        go = rows[Math.min(at + 1, rows.length - 1)];
        break;
      case "ArrowUp":
        go = rows[Math.max(at - 1, 0)];
        break;
      case "Home":
        go = rows[0];
        break;
      case "End":
        go = rows[rows.length - 1];
        break;
      case "ArrowRight":
        if (row.hasChildren && !open.has(row.span.id)) toggle(row.span.id, true);
        else if (row.hasChildren) go = rows[at + 1];
        break;
      case "ArrowLeft":
        if (row.hasChildren && open.has(row.span.id)) toggle(row.span.id, false);
        else go = rows.find((candidate) => candidate.span.id === row.parent);
        break;
      case "Enter":
        if (row.hasChildren) toggle(row.span.id);
        onSelect(row.span.id);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (go !== undefined) onSelect(go.span.id);
  }

  return (
    <div ref={tree} role="tree" aria-label="Trace" onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto">
      {rows.map((row) => (
        <TreeRow
          key={row.span.id}
          row={row}
          open={open.has(row.span.id)}
          selected={row.span.id === selected}
          tabStop={row.span.id === tabId}
          onSelect={() => onSelect(row.span.id)}
          onToggle={() => toggle(row.span.id)}
        />
      ))}
    </div>
  );
}
