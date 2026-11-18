import { needsYouCount } from "@golem/view";
import { useNavigate, useRunList } from "../../store/page-context.tsx";
import type { RunInfo } from "../../store/runs.ts";
import { useNow } from "../sessions/use-now.ts";
import { RunsList } from "./runs-list.tsx";

/** The summary line under the title: what needs you, and how many runs there are. */
export function runsSummary(runs: readonly RunInfo[]): string {
  const needs = needsYouCount(runs);
  const total = runs.length === 1 ? "1 run" : `${runs.length} runs`;
  return needs === 0 ? total : `${needs} need${needs === 1 ? "s" : ""} you · ${total}`;
}

/** `/runs`: every routine firing and detached ask, newest first, in the groups Needs you, Running, Today and Earlier. */
export function RunsScreen() {
  const query = useRunList();
  const navigate = useNavigate();
  const now = useNow();
  const runs = query.data?.runs ?? null;
  return (
    <div data-screen="runs" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-5">
      <div className="flex max-w-4xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-prose text-2xl font-normal tracking-tight">Runs</h1>
          <p className="text-sm text-muted">{runs === null || runs.length === 0 ? "What golem did while you were away, and what needs you." : runsSummary(runs)}</p>
        </div>
        <RunsList runs={runs} error={query.error?.message ?? null} now={now} onNavigate={navigate} />
      </div>
    </div>
  );
}
