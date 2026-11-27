import { useId, useMemo, useState } from "react";
import { cn } from "../../ui/cn.ts";
import { Input } from "../../ui/input.tsx";
import { useNavigate, useNewSessionFolder, useRoute, useWorkflowList, useWorkflowStarters } from "../../store/page-context.tsx";
import { workflowPath } from "../../store/router.ts";
import type { WorkflowEntryInfo, WorkflowListResult, WorkflowStarterInfo } from "../../store/workflows.ts";
import { Link } from "../../ui/link.tsx";
import { folderName } from "../sessions/folder.ts";
import { WorkflowDot } from "./workflow-dot.tsx";
import { workflowGroups, workflowRowLine, type WorkflowGroup } from "./text.ts";
import { starterStillToAdd } from "./workflows-empty.tsx";

function WorkflowRow({ workflow, selected, onNavigate }: { workflow: WorkflowEntryInfo; selected: boolean; onNavigate: (path: string) => void }) {
  return (
    <li>
      <Link
        href={workflowPath(workflow.id)}
        onNavigate={onNavigate}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md py-1.5 pr-2.5 pl-2.5 text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2",
          selected && "bg-surface text-ink ring-1 ring-line ring-inset",
        )}
      >
        <WorkflowDot state={workflow.state} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 truncate">{workflow.name}</span>
          <span className={cn("truncate text-xs", workflow.state === "broken" ? "text-deny" : workflow.state === "untrusted" ? "text-wait" : "text-faint")}>
            {workflowRowLine(workflow)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Group({ group, selected, onNavigate }: { group: WorkflowGroup<WorkflowEntryInfo>; selected: string | null; onNavigate: (path: string) => void }) {
  const headingId = useId();
  return (
    <div>
      <div id={headingId} className="mb-1 px-2.5 text-xs font-medium text-faint">
        {group.label}
        {group.folder === null || group.label === folderName(group.folder) ? null : <span className="font-normal"> · {folderName(group.folder)}</span>}
      </div>
      <ul aria-labelledby={headingId} className="flex flex-col gap-px">
        {group.workflows.map((workflow) => (
          <WorkflowRow key={workflow.id} workflow={workflow} selected={selected === workflow.id} onNavigate={onNavigate} />
        ))}
      </ul>
    </div>
  );
}

/** The starters not added yet. Each opens `/workflows`, where its card adds it. */
function StarterGroup({ starters, onNavigate }: { starters: readonly WorkflowStarterInfo[]; onNavigate: (path: string) => void }) {
  const headingId = useId();
  return (
    <div>
      <div id={headingId} className="mb-1 px-2.5 text-xs font-medium text-faint">
        Starters
      </div>
      <ul aria-labelledby={headingId} className="flex flex-col gap-px">
        {starters.map((starter) => (
          <li key={starter.id}>
            <Link
              href={workflowPath()}
              onNavigate={onNavigate}
              className="flex items-center gap-2 rounded-md py-1.5 pr-2.5 pl-2.5 text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2"
            >
              <span aria-hidden="true" className="w-2 text-center text-faint">
                +
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="min-w-0 truncate">{starter.title}</span>
                <span className="truncate text-xs text-faint">{starter.line}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type WorkflowsPanelProps = {
  /** The daemon's answer, or null while it has not come. */
  list: WorkflowListResult | null;
  /** The reason the answer did not come, if it did not. */
  error?: string | null;
  /** The starters not added yet, listed under the workflows. */
  starters?: readonly WorkflowStarterInfo[];
  /** The id of the workflow in view. */
  selected: string | null;
  onNavigate: (path: string) => void;
};

/** The workflows panel's body: a filter, then the workflows of this project and yours. A broken one shows its error. */
export function WorkflowsPanel({ list, error = null, starters = [], selected, onNavigate }: WorkflowsPanelProps) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const workflows = list?.workflows;
  const shown = useMemo(() => (workflows ?? []).filter((workflow) => needle === "" || workflow.name.toLowerCase().includes(needle)), [workflows, needle]);
  const grouped = useMemo(() => workflowGroups(shown), [shown]);
  let note: string | null = null;
  if (list === null) note = error === null ? "Loading workflows." : "Could not load workflows.";
  else if (list.workflows.length === 0) note = "No workflows yet.";
  else if (shown.length === 0) note = "No workflows match.";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input
        type="text"
        aria-label="Filter workflows"
        placeholder="Filter workflows"
        autoComplete="off"
        spellCheck={false}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && filter !== "") {
            event.preventDefault();
            setFilter("");
          }
        }}
        className="py-1.5"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5">
        {note === null ? null : (
          <p className="px-2.5 py-2 text-sm text-muted">
            {note}
            {list !== null && list.workflows.length === 0 ? (
              <>
                {" "}
                <Link href={workflowPath()} onNavigate={onNavigate} className="text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2">
                  See what a workflow does
                </Link>
              </>
            ) : null}
          </p>
        )}
        {grouped.map((group) => (
          <Group key={group.key} group={group} selected={selected} onNavigate={onNavigate} />
        ))}
        {list === null || list.workflows.length === 0 || needle !== "" || starters.length === 0 ? null : <StarterGroup starters={starters} onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

/** The workflows panel on the live page. */
export function LiveWorkflowsPanel() {
  const query = useWorkflowList();
  const route = useRoute();
  const navigate = useNavigate();
  const starters = useWorkflowStarters();
  const [folder] = useNewSessionFolder();
  const left = query.data === undefined ? [] : starterStillToAdd(starters.data?.starters ?? [], query.data.workflows, folder);
  return <WorkflowsPanel list={query.data ?? null} error={query.error?.message ?? null} starters={left} selected={route.name === "workflow" ? route.id : null} onNavigate={navigate} />;
}
