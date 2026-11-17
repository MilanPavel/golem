import { useId, useMemo, useState } from "react";
import { routineRowLine, routineState } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Input } from "../../ui/input.tsx";
import { Link } from "../../ui/link.tsx";
import { useNavigate, useRoute, useRoutineList } from "../../store/page-context.tsx";
import { routinePath } from "../../store/router.ts";
import type { RoutineInfo, RoutineListResult } from "../../store/routines.ts";
import { folderName } from "../sessions/folder.ts";
import { useNow } from "../sessions/use-now.ts";
import { RoutineDot } from "./routine-dot.tsx";

/** The routine in view: its name, and the project it belongs to (null for one of yours). */
export type SelectedRoutine = { name: string; folder: string | null };

function RoutineRow({ routine, selected, now, onNavigate }: { routine: RoutineInfo; selected: boolean; now: number; onNavigate: (path: string) => void }) {
  const state = routineState(routine);
  return (
    <li>
      <Link
        href={routinePath(routine.config.name, routine.folder)}
        onNavigate={onNavigate}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md py-1.5 pr-2.5 pl-2.5 text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2",
          selected && "bg-surface text-ink ring-1 ring-line ring-inset",
          state === "off" && "opacity-70",
        )}
      >
        <RoutineDot state={state} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 truncate">{routine.config.name}</span>
          <span className={cn("truncate text-xs", state === "failed" ? "text-deny" : state === "waiting" ? "text-wait" : "text-faint")}>
            {routineRowLine(routine, now)}
          </span>
        </span>
      </Link>
    </li>
  );
}

type Group = { key: string; label: string; routines: RoutineInfo[] };

/** Yours first, then each project's, each group in the daemon's order. */
function groups(routines: readonly RoutineInfo[]): Group[] {
  const found = new Map<string, Group>();
  for (const routine of routines) {
    const key = routine.folder ?? "";
    const group = found.get(key) ?? { key, label: routine.folder === null || routine.folder === undefined ? "Yours" : folderName(routine.folder), routines: [] };
    group.routines.push(routine);
    found.set(key, group);
  }
  return [...found.values()];
}

function RoutineGroup({ group, selected, now, onNavigate }: { group: Group; selected: SelectedRoutine | null; now: number; onNavigate: (path: string) => void }) {
  const headingId = useId();
  return (
    <div>
      <div id={headingId} className="mb-1 px-2.5 text-xs font-medium text-faint">
        {group.label}
      </div>
      <ul aria-labelledby={headingId} className="flex flex-col gap-px">
        {group.routines.map((routine) => (
          <RoutineRow
            key={`${routine.folder ?? ""}/${routine.config.name}`}
            routine={routine}
            selected={selected !== null && selected.name === routine.config.name && selected.folder === (routine.folder ?? null)}
            now={now}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

export type RoutinesPanelProps = {
  /** The daemon's answer, or null while it has not come. */
  list: RoutineListResult | null;
  /** The reason the answer did not come, if it did not. */
  error?: string | null;
  selected: SelectedRoutine | null;
  now: number;
  onNavigate: (path: string) => void;
};

/** The routines panel's body: a filter, then the routines by where they live, and the files that did not load. */
export function RoutinesPanel({ list, error = null, selected, now, onNavigate }: RoutinesPanelProps) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const routines = list?.routines;
  const shown = useMemo(
    () => (routines ?? []).filter((routine) => needle === "" || routine.config.name.toLowerCase().includes(needle)),
    [routines, needle],
  );
  const grouped = useMemo(() => groups(shown), [shown]);
  const issues = list?.issues ?? [];
  let note: string | null = null;
  if (list === null) note = error === null ? "Loading routines." : "Could not load routines.";
  else if (list.routines.length === 0) note = "No routines yet.";
  else if (shown.length === 0) note = "No routines match.";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input
        type="text"
        aria-label="Filter routines"
        placeholder="Filter routines"
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
            {list !== null && list.routines.length === 0 ? (
              <>
                {" "}
                <Link href={routinePath()} onNavigate={onNavigate} className="text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2">
                  See what a routine does
                </Link>
              </>
            ) : null}
          </p>
        )}
        {grouped.map((group) => (
          <RoutineGroup key={group.key} group={group} selected={selected} now={now} onNavigate={onNavigate} />
        ))}
        {issues.length === 0 ? null : (
          <ul aria-label="Routines that did not load" className="flex flex-col gap-1 px-2.5 text-xs text-deny">
            {issues.map((issue) => (
              <li key={`${issue.file}:${issue.line ?? 0}:${issue.message}`} className="text-pretty">
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The routines panel on the live page. It refreshes its "next in 14 h" labels once a minute. */
export function LiveRoutinesPanel() {
  const query = useRoutineList();
  const route = useRoute();
  const navigate = useNavigate();
  const now = useNow();
  return (
    <RoutinesPanel
      list={query.data ?? null}
      error={query.error?.message ?? null}
      selected={route.name === "routine" ? { name: route.routine, folder: route.folder } : null}
      now={now}
      onNavigate={navigate}
    />
  );
}
