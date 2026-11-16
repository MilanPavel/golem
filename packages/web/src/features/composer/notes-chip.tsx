import { notesChip } from "@golem/view";
import { useState } from "react";
import { useNotes } from "../../store/page-context.tsx";
import { badgeVariants } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { openWorkbench } from "../workbench/index.ts";

const FOCUS = "outline-offset-2 outline-clay focus-visible:outline-2";

/**
 * The review notes waiting for the next message: a button that opens the Changes tab, and an "×"
 * that removes them all after a question.
 */
export function NotesChipView({ label, onOpen, onRemoveAll }: { label: string; onOpen: () => void; onRemoveAll: () => void }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <span className={cn(badgeVariants({ tone: "wait" }), "gap-1 py-0 pr-1")}>
        <button
          type="button"
          aria-label={`${label}. Open the Changes tab.`}
          onClick={onOpen}
          className={cn("cursor-pointer rounded-sm py-1", FOCUS)}
        >
          <span aria-hidden="true">💬 </span>
          {label}
        </button>
        <button
          type="button"
          aria-label="Remove all notes"
          onClick={() => {
            setAsking(true);
          }}
          className={cn("cursor-pointer rounded-full px-1.5 py-1 leading-none hover:bg-line", FOCUS)}
        >
          <span aria-hidden="true">×</span>
        </button>
      </span>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogTitle>Remove all notes?</DialogTitle>
          <DialogDescription>The notes are not sent. This cannot be undone.</DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild>
              <Button kind="secondary">Cancel</Button>
            </DialogClose>
            <Button
              kind="danger"
              onClick={() => {
                onRemoveAll();
                setAsking(false);
              }}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The chip of a session, or nothing while it has no notes. */
export function NotesChip({ sessionId }: { sessionId: string }) {
  const { state, clear } = useNotes(sessionId);
  const label = notesChip(state);
  if (label === null) return null;
  return <NotesChipView label={label} onOpen={() => openWorkbench("changes")} onRemoveAll={clear} />;
}
