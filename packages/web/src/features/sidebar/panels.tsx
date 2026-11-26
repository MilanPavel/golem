import type { ComponentType } from "react";
import { useInbox } from "../../store/inbox.ts";
import { InboxPanel } from "../inbox/index.ts";
import { LiveSessionsPanel } from "./sessions-panel.tsx";
import { LiveRoutinesPanel } from "../routines/index.ts";
import { LiveDataPanel } from "../data/index.ts";
import { LiveRunsPanel } from "../runs/index.ts";
import { LiveWorkflowsPanel } from "../workflows/index.ts";
import type { RailItem } from "./rail.tsx";

/** The Inbox item's body: what waits for you, answered through the store. */
function InboxBody() {
  const inbox = useInbox();
  return <InboxPanel items={inbox.items} groups={inbox.groups} busy={inbox.busy} errors={inbox.errors} onAnswer={inbox.answer} onOpen={inbox.open} />;
}

/** What each rail item shows in the panel. Mounting a real panel for an item is a change to its line. */
export const PANELS: Record<RailItem, { title: string; Body: ComponentType }> = {
  sessions: { title: "Sessions", Body: LiveSessionsPanel },
  inbox: { title: "Inbox", Body: InboxBody },
  data: { title: "Data", Body: LiveDataPanel },
  routines: { title: "Routines", Body: LiveRoutinesPanel },
  workflows: { title: "Workflows", Body: LiveWorkflowsPanel },
  runs: { title: "Runs", Body: LiveRunsPanel },
};
