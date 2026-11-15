import { diffCounts, parseDiff, type ToolBlock } from "@golem/view";
import { useId, useMemo, useState } from "react";
import { cn } from "../../ui/cn.ts";
import { DiffView } from "../diff/diff-view.tsx";
import { openChange } from "../workbench/workbench-state.ts";

const EDIT_TOOLS = new Set(["write_file", "edit_file"]);

/** A finished, successful file edit with a path: the calls that are drawn as a card. */
export function isEditCard(tool: ToolBlock): boolean {
  return EDIT_TOOLS.has(tool.name) && tool.status === "done" && tool.unsuccessful !== true && typeof tool.args["path"] === "string";
}

const FOCUS = "outline-offset-2 outline-clay focus-visible:outline-2";

/**
 * A file edit as one quiet line: the path and the line counts. Clicking it shows the change in the panel;
 * the chevron opens the diff right below, for a panel that is closed. Without a diff (a session recorded
 * before diffs were kept) it shows no counts and no chevron.
 */
export function EditCard({ tool }: { tool: ToolBlock }) {
  const path = String(tool.args["path"]);
  const rows = useMemo(() => (tool.diff ? parseDiff(tool.diff) : null), [tool.diff]);
  const counts = rows ? diffCounts(rows) : null;
  const [open, setOpen] = useState(false);
  const diffId = useId();
  return (
    <li data-edit-card className="flex min-w-0 flex-col font-mono text-xs leading-snug">
      <div className="flex min-w-0 items-center rounded-md border border-line bg-sunken">
        <button
          type="button"
          aria-label={`Show the change to ${path}`}
          className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-line", FOCUS)}
          onClick={() => {
            openChange(path);
          }}
        >
          <span aria-hidden="true" className="text-muted">{counts?.created ? "＋" : "✎"}</span>
          <span className="truncate text-ink" title={path}>{path}</span>
          {counts ? (
            <>
              <span className="text-allow">+{counts.added}</span>
              <span className="text-deny">−{counts.deleted}</span>
            </>
          ) : null}
          {counts?.created ? <span className="rounded-full bg-clay-soft px-1.5 text-clay-ink">new</span> : null}
        </button>
        {rows ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={diffId}
            aria-label={`Show the diff of ${path} here`}
            className={cn("grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-faint hover:bg-line hover:text-ink", FOCUS)}
            onClick={() => {
              setOpen((value) => !value);
            }}
          >
            <span aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-90")}>›</span>
          </button>
        ) : null}
      </div>
      {open && tool.diff ? (
        <div id={diffId} className="mt-1">
          <DiffView diff={tool.diff} mode="unified" />
        </div>
      ) : null}
    </li>
  );
}

/** The edit cards of a turn, one per finished edit. */
export function EditCards({ tools }: { tools: readonly ToolBlock[] }) {
  if (tools.length === 0) return null;
  return (
    <ul aria-label="Edited files" className="flex list-none flex-col gap-1 p-0">
      {tools.map((tool) => (
        <EditCard key={tool.callId} tool={tool} />
      ))}
    </ul>
  );
}
