import { useState, type ReactNode } from "react";
import { rewindPlan, UNDO_CONFLICT_QUESTION, UNDO_CONFLICT_TITLE, type RewindPlan, type TurnCard } from "@golem/view";
import { actionErrorText } from "../../store/errors.ts";
import type { ChangesRevertTarget } from "../../store/changes.ts";
import { usePageActions, useSession } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { Code } from "../../ui/code.tsx";

/** `1 turn`, `2 turns`. */
function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function turnName(card: TurnCard): string {
  return card.title === "" ? "a request" : card.title;
}

export type RewindDialogViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: RewindPlan;
  working: boolean;
  onConfirm: () => void;
};

/** The question before a rewind of more than one turn: the turns and the files it takes back. It calls nothing. */
export function RewindDialogView({ open, onOpenChange, plan, working, onConfirm }: RewindDialogViewProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (working ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Rewind {count(plan.turns.length, "turn")}?</DialogTitle>
        <DialogDescription>
          This puts back {count(plan.paths.length, "file")} as they were before the oldest of these turns. You can redo it.
        </DialogDescription>
        <p className="mt-4 text-xs font-medium text-muted">Turns</p>
        <ul aria-label="Turns to take back" className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2 text-sm text-ink">
          {plan.turns.map((card) => (
            <li key={card.runId} className="break-words">
              {card.number} · {turnName(card)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs font-medium text-muted">Files</p>
        <ul aria-label="Files to put back" className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2 text-meta">
          {plan.paths.map((path) => (
            <li key={path} className="truncate" title={path}>
              <Code>{path}</Code>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button kind="secondary" disabled={working}>
              Cancel
            </Button>
          </DialogClose>
          <Button kind="primary" disabled={working} onClick={onConfirm}>
            {working ? "Rewinding…" : "Rewind"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type ConflictDialogViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The files golem left alone. */
  paths: readonly string[];
  working: boolean;
  onOverwrite: () => void;
  onKeep: () => void;
};

/** The files that changed since golem wrote them, and the choice to overwrite them or keep them. It calls nothing. */
export function ConflictDialogView({ open, onOpenChange, paths, working, onOverwrite, onKeep }: ConflictDialogViewProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (working ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{UNDO_CONFLICT_TITLE}</DialogTitle>
        <ul aria-label="Files changed since golem wrote them" className="mt-3 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2 text-meta">
          {paths.map((path) => (
            <li key={path} className="truncate" title={path}>
              <Code>{path}</Code>
            </li>
          ))}
        </ul>
        <DialogDescription className="mt-3">{UNDO_CONFLICT_QUESTION}</DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          <Button kind="secondary" disabled={working} onClick={onKeep}>
            Keep mine
          </Button>
          <Button kind="primary" disabled={working} onClick={onOverwrite}>
            {working ? "Overwriting…" : "Overwrite"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Pending =
  | { kind: "rewind"; targets: ChangesRevertTarget[]; plan: RewindPlan }
  | { kind: "conflicts"; targets: ChangesRevertTarget[]; paths: string[] };

export type Undo = {
  /** A run is active: nothing can be undone until it ends. */
  disabled: boolean;
  /**
   * Sends each target in turn. With a `plan` of more than one turn it asks first. A file that changed
   * since golem wrote it opens the conflict dialog.
   */
  ask: (targets: ChangesRevertTarget[], plan?: RewindPlan) => void;
  /** Rewinds to before a turn. `cards` are the session's turn cards, newest first. */
  rewind: (cards: readonly TurnCard[], runId: string) => void;
  /** The dialogs, and a line when a call failed. Render once, anywhere. */
  dialogs: ReactNode;
};

/** What the undo buttons of one session share: the busy state, the calls, and the two dialogs. */
export function useUndo(sessionId: string): Undo {
  const actions = usePageActions();
  const disabled = useSession(sessionId, (view) => view.chat.busy);
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(targets: ChangesRevertTarget[], force: boolean): Promise<void> {
    setWorking(true);
    setError(null);
    try {
      const left: ChangesRevertTarget[] = [];
      const paths = new Set<string>();
      for (const target of targets) {
        const result = await actions.revert(sessionId, target, force);
        if (result.conflicts.length > 0) {
          left.push(target);
          for (const conflict of result.conflicts) paths.add(conflict.path);
        }
      }
      setPending(left.length > 0 ? { kind: "conflicts", targets: left, paths: [...paths] } : null);
    } catch (failure) {
      setPending(null);
      setError(actionErrorText(failure, "Could not undo."));
    } finally {
      setWorking(false);
    }
  }

  function ask(targets: ChangesRevertTarget[], plan?: RewindPlan): void {
    if (plan !== undefined && plan.turns.length > 1) {
      setError(null);
      setPending({ kind: "rewind", targets, plan });
      return;
    }
    void send(targets, false);
  }

  const dialogs = (
    <>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <RewindDialogView
        open={pending?.kind === "rewind"}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        plan={pending?.kind === "rewind" ? pending.plan : { turns: [], paths: [] }}
        working={working}
        onConfirm={() => {
          if (pending?.kind === "rewind") void send(pending.targets, false);
        }}
      />
      <ConflictDialogView
        open={pending?.kind === "conflicts"}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        paths={pending?.kind === "conflicts" ? pending.paths : []}
        working={working}
        onOverwrite={() => {
          if (pending?.kind === "conflicts") void send(pending.targets, true);
        }}
        onKeep={() => {
          setPending(null);
        }}
      />
    </>
  );

  return {
    disabled,
    ask,
    rewind: (cards, runId) => {
      ask([{ kind: "run", runId }], rewindPlan(cards, runId));
    },
    dialogs,
  };
}

/** The targets that redo a turn: a revert of each revert that stands. */
export function redoTargets(card: Pick<TurnCard, "revertIds">): ChangesRevertTarget[] {
  return card.revertIds.map((changeId) => ({ kind: "change", changeId }));
}
