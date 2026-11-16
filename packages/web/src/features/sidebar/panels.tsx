import type { ComponentType } from "react";
import { LiveSessionList } from "../sessions/index.ts";
import { RoutinesInProgress, RunsInProgress, WorkflowsInProgress } from "./in-progress.tsx";
import type { RailItem } from "./rail.tsx";

/** Until the Inbox panel is mounted here, it says there is nothing to answer. */
function InboxPlaceholder() {
  return <p className="px-2 py-3 text-sm text-muted">Nothing is waiting for you.</p>;
}

/** What each rail item shows in the panel. Mounting a real panel for an item is a change to its line. */
export const PANELS: Record<RailItem, { title: string; Body: ComponentType }> = {
  sessions: { title: "Sessions", Body: LiveSessionList },
  inbox: { title: "Inbox", Body: InboxPlaceholder },
  routines: { title: "Routines", Body: RoutinesInProgress },
  workflows: { title: "Workflows", Body: WorkflowsInProgress },
  runs: { title: "Runs", Body: RunsInProgress },
};
