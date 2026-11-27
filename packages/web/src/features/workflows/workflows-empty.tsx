import { useId, useState } from "react";
import { NEW_WORKFLOW_BUTTON } from "@golem/view";
import type { WorkflowEntryInfo, WorkflowStarterInfo } from "../../store/workflows.ts";
import { Button } from "../../ui/button.tsx";
import { Card } from "../../ui/card.tsx";

/** Adds a starter, and its routine when `routine` is true. Rejects with the reason, which the card shows. The live page opens the new workflow when it resolves. */
export type AddStarter = (starter: WorkflowStarterInfo, routine: boolean) => Promise<void>;

/** The starters that have no file yet: a project starter counts as added when the project folder has a workflow of that name, a user starter when your own folder has. */
export function starterStillToAdd(starters: readonly WorkflowStarterInfo[], workflows: readonly WorkflowEntryInfo[], folder: string | null): WorkflowStarterInfo[] {
  return starters.filter(
    (starter) => !workflows.some((workflow) => workflow.name === starter.id && (starter.needs_folder ? folder !== null && workflow.project === folder : workflow.project === undefined || workflow.project === null)),
  );
}

/** What the card says when its button is off, or null when it can be used. */
function whyOff(starter: WorkflowStarterInfo, folder: string | null): string | null {
  return starter.needs_folder && folder === null ? "This one works on a project. Start a session in a project folder first, then come back." : null;
}

export function StarterCard({ starter, folder, onAdd, failed }: { starter: WorkflowStarterInfo; folder: string | null; onAdd: AddStarter; failed: StarterFailure | undefined }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(failed?.id === starter.id ? failed.text : null);
  const off = whyOff(starter, folder);
  const reasonId = useId();
  const add = async (routine: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await onAdd(starter, routine);
    } catch (reason) {
      setError(reason instanceof Error && reason.message !== "" ? reason.message : "The workflow could not be added.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex h-full flex-col gap-3">
      <h2 className="text-sm font-semibold">{starter.title}</h2>
      <p className="flex-1 text-sm text-pretty text-muted">{starter.line}</p>
      {off === null ? null : (
        <p id={reasonId} className="text-xs text-muted">
          {off}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="rounded-md border border-deny bg-deny-soft px-2.5 py-1.5 text-xs text-deny wrap-anywhere">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" kind={starter.routine ? "secondary" : "primary"} disabled={off !== null || busy} aria-describedby={off === null ? undefined : reasonId} onClick={() => void add(false)}>
          {busy ? "Adding" : starter.routine ? "Add" : "Use this starter"}
        </Button>
        {starter.routine ? (
          <Button size="sm" disabled={off !== null || busy} aria-describedby={off === null ? undefined : reasonId} onClick={() => void add(true)}>
            Add and run {starter.routine.words}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** A refusal a card starts with, for the gallery: the id of the starter and the text under it. */
export type StarterFailure = { id: string; text: string };

export type WorkflowsEmptyProps = {
  /** Opens the page that makes a new workflow. */
  onNew: () => void;
};

/** What `/workflows` shows when there are none: what a workflow is, and the way to make one. The starters are on the New workflow page. */
export function WorkflowsEmpty({ onNew }: WorkflowsEmptyProps) {
  return (
    <div data-screen="workflows-empty" className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-prose text-2xl font-normal tracking-tight">No workflows yet</h1>
        <p className="text-sm text-muted">
          A workflow runs several steps for you, on a schedule or when you ask, and leaves its result in the Inbox. Each one is a Python file in ~/.golem/workflows.
        </p>
      </div>
      <div>
        <Button kind="primary" onClick={onNew}>
          {NEW_WORKFLOW_BUTTON}
        </Button>
      </div>
      <p className="text-sm text-muted">Describe what you want, start from a starter, or begin with an empty file.</p>
    </div>
  );
}
