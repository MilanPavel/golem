import { memoryLabel, memoryStateText, memoryUsableNote } from "@golem/view";
import { useState } from "react";
import { itemMayGoToPaid, memoryErrorText, type MemoryItem, type MemoryPrivacy } from "../../../store/memory.ts";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { Code } from "../../../ui/code.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog.tsx";
import { Textarea } from "../../../ui/textarea.tsx";
import { MemorySwitch } from "./memory-switch.tsx";

/** What a row does. Each call rejects when the daemon refuses it; the row shows why. */
export type MemoryRowActions = {
  onEdit: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAlways: (id: string, always: boolean) => Promise<void>;
  onPrivacy: (id: string, privacy: MemoryPrivacy) => Promise<void>;
};

/** The longest a memory may be (ADR-061): a longer text is a skill. */
export const MEMORY_MAX_CHARS = 2000;

/** One memory: who wrote it, its state, its text, and the controls to edit it, delete it and set where it may go. */
export function MemoryRow({ item, actions }: { item: MemoryItem; actions: MemoryRowActions }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = memoryStateText(item);
  const note = memoryUsableNote(item);
  const mayGo = itemMayGoToPaid(item);
  const sources = item.sources ?? [];

  async function run(action: () => Promise<void>, fallback: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(memoryErrorText(caught, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (await run(() => actions.onEdit(item.id, draft), "Could not save the memory.")) setEditing(false);
  }

  async function remove() {
    if (await run(() => actions.onDelete(item.id), "Could not delete the memory.")) setConfirming(false);
  }

  return (
    <li aria-label={item.title} className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="min-w-0 flex-1 text-sm font-medium wrap-anywhere">{item.title}</h3>
        <span className="text-meta whitespace-nowrap text-faint">{memoryLabel(item)}</span>
      </div>
      {state === "" && note === null ? null : (
        <p className={cn("text-meta", item.state === "stale" ? "text-wait" : "text-muted")}>
          {state}
          {state !== "" && note !== null ? " · " : ""}
          {note}
        </p>
      )}
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label={`Text of ${item.title}`}
            value={draft}
            maxLength={MEMORY_MAX_CHARS}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-28"
          />
          <div className="flex items-center gap-2">
            <Button kind="primary" size="sm" disabled={busy || draft.trim() === ""} onClick={() => void save()}>
              Save
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setDraft(item.text);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <span className="ml-auto text-meta text-faint">
              {draft.length} / {MEMORY_MAX_CHARS}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm whitespace-pre-wrap wrap-anywhere text-ink">{item.text}</p>
      )}
      {sources.length === 0 ? null : (
        <ul aria-label="Sources" className="flex flex-col gap-0.5 text-meta text-muted">
          {sources.map((source) => (
            <li key={source.path} className="wrap-anywhere">
              <Code tone="muted">{source.path}</Code>
            </li>
          ))}
        </ul>
      )}
      {error === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2 text-xs text-muted">
          <MemorySwitch checked={mayGo} label={`${item.title}: may be sent to a paid model`} disabled={busy} onToggle={() => void run(() => actions.onPrivacy(item.id, mayGo ? "local" : "chat"), "Could not change the memory.")} />
          may be sent to a paid model
        </span>
        {item.scope === "history" ? null : (
          <span className="flex items-center gap-2 text-xs text-muted">
            <MemorySwitch checked={item.always === true} label={`${item.title}: in every chat`} disabled={busy} onToggle={() => void run(() => actions.onAlways(item.id, item.always !== true), "Could not change the memory.")} />
            in every chat
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            disabled={editing}
            aria-label={`Edit ${item.title}`}
            onClick={() => {
              setDraft(item.text);
              setEditing(true);
            }}
          >
            Edit
          </Button>
          <Button size="sm" kind="danger" aria-label={`Delete ${item.title}`} onClick={() => setConfirming(true)}>
            Delete
          </Button>
        </span>
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle>Delete this memory?</DialogTitle>
          <DialogDescription>There is no trash: it is gone from golem. A chat that already used it keeps its own copy.</DialogDescription>
          <p className="mt-3 text-sm wrap-anywhere">{item.title}</p>
          {error === null ? null : (
            <p role="alert" className="mt-2 text-xs text-deny">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button kind="danger" disabled={busy} onClick={() => void remove()}>
              Delete memory
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}
