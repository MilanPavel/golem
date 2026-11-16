import { useEffect, useId, useRef, useState } from "react";
import { branchLine, COMMIT_NOTE, SUGGESTING, withSuggestion } from "@golem/view";
import { actionErrorText } from "../../store/errors.ts";
import { usePageActions } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { Textarea } from "../../ui/textarea.tsx";

export type CommitDialogViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: string | null;
  paths: readonly string[];
  /** The paths that are checked. */
  chosen: ReadonlySet<string>;
  onToggle: (path: string) => void;
  message: string;
  onMessage: (text: string) => void;
  suggesting: boolean;
  /** A line under the message when no suggestion could be had. */
  suggestNote: string | null;
  onSuggestAgain: () => void;
  /** A run is active: the files may still change, so nothing is committed now. */
  runActive: boolean;
  committing: boolean;
  onCommit: () => void;
  /** What git printed when it refused the commit. */
  failure: string | null;
  /** A problem that kept the call from reaching git. */
  error: string | null;
};

/** The commit dialog. It reads and calls nothing: the person's click on Commit is the only way a commit starts. */
export function CommitDialogView(props: CommitDialogViewProps) {
  const { paths, chosen, message, suggesting, runActive, committing, failure, error } = props;
  const messageId = useId();
  const noneChosen = chosen.size === 0;
  const canCommit = !runActive && !committing && !noneChosen && message.trim() !== "";
  return (
    <Dialog open={props.open} onOpenChange={(next) => (committing ? undefined : props.onOpenChange(next))}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Commit changes</DialogTitle>
        <DialogDescription>{branchLine(props.branch)}</DialogDescription>
        <p className="mt-2 text-sm text-muted">{COMMIT_NOTE}</p>
        <fieldset className="mt-4 min-w-0">
          <legend className="mb-1 text-xs font-medium text-muted">Files</legend>
          <ul className="relative flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2">
            {paths.map((path) => (
              <li key={path}>
                <label className="flex min-w-0 items-center gap-2 font-mono text-xs text-ink">
                  <input
                    type="checkbox"
                    className="size-4 flex-none accent-clay"
                    checked={chosen.has(path)}
                    disabled={committing}
                    onChange={() => props.onToggle(path)}
                  />
                  <span className="min-w-0 truncate" title={path}>
                    {path}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor={messageId} className="text-xs font-medium text-muted">
              Message
            </label>
            <Button kind="ghost" size="sm" disabled={noneChosen || suggesting || committing} onClick={props.onSuggestAgain}>
              Suggest again
            </Button>
          </div>
          <Textarea
            id={messageId}
            rows={5}
            value={message}
            placeholder={suggesting ? SUGGESTING : "Describe the change"}
            disabled={committing}
            onChange={(event) => props.onMessage(event.target.value)}
          />
          {props.suggestNote === null ? null : (
            <p role="status" className="mt-1 text-xs text-muted">
              {props.suggestNote}
            </p>
          )}
        </div>
        {runActive ? (
          <p role="status" className="mt-3 text-sm text-muted">
            A run is active. Commit when it ends.
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-deny">
            {error}
          </p>
        )}
        {failure === null ? null : (
          <div className="mt-3">
            <p role="alert" className="mb-1 text-sm text-deny">
              Git did not commit.
            </p>
            <pre className="max-h-40 overflow-auto rounded-md border border-line bg-sunken p-2 font-mono text-xs whitespace-pre-wrap text-ink">{failure}</pre>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button kind="secondary" disabled={committing}>
              Cancel
            </Button>
          </DialogClose>
          <Button kind="primary" disabled={!canCommit} onClick={props.onCommit}>
            {committing ? "Committing…" : "Commit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type CommitDialogProps = {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: string | null;
  paths: readonly string[];
  runActive: boolean;
  /** Called with the short hash after git committed. */
  onCommitted: (sha: string | null) => void;
};

/**
 * Asks the model for a message, keeps what the person types, and commits the checked files when
 * they press Commit. A suggestion fills an empty box only.
 */
export function CommitDialog(props: CommitDialogProps) {
  // The state starts fresh each time the dialog opens.
  return props.open ? <OpenCommitDialog {...props} /> : null;
}

function OpenCommitDialog({ sessionId, open, onOpenChange, branch, paths, runActive, onCommitted }: CommitDialogProps) {
  const actions = usePageActions();
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  // The checked files an answer came for, and whether it was a suggestion: the box shows "Suggesting…" until then.
  const [answered, setAnswered] = useState<{ key: string; failed: boolean } | null>(null);
  const [again, setAgain] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Counts what the person typed, so an answer that comes later does not undo it.
  const edits = useRef(0);
  const asked = useRef(0);
  const chosen = new Set(paths.filter((path) => !unchecked.has(path)));
  const chosenKey = JSON.stringify([...chosen]);

  function suggest(list: string[], replace: boolean): void {
    const ticket = (asked.current += 1);
    const editsAtStart = edits.current;
    const key = JSON.stringify(list);
    actions.suggestCommitMessage(sessionId, list).then(
      (result) => {
        if (asked.current !== ticket) return;
        setAgain(false);
        setAnswered({ key, failed: false });
        const text = result.message;
        setMessage((current) => (replace && edits.current === editsAtStart ? text : withSuggestion(current, text)));
      },
      () => {
        if (asked.current !== ticket) return;
        setAgain(false);
        setAnswered({ key, failed: true });
      },
    );
  }

  // The suggestion follows the checked files.
  useEffect(() => {
    const list = JSON.parse(chosenKey) as string[];
    if (list.length === 0) {
      asked.current += 1;
      return;
    }
    suggest(list, false);
    return () => {
      asked.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `suggest` only reads refs and stable setters.
  }, [chosenKey, sessionId]);

  function commit(): void {
    setCommitting(true);
    setFailure(null);
    setError(null);
    actions.commit(sessionId, [...chosen], message).then(
      (result) => {
        setCommitting(false);
        if (result.ok) {
          onOpenChange(false);
          onCommitted(result.sha);
        } else {
          setFailure(result.output.trim() === "" ? "Git gave no output." : result.output);
        }
      },
      (err: unknown) => {
        setCommitting(false);
        setError(actionErrorText(err, "Could not commit."));
      },
    );
  }

  return (
    <CommitDialogView
      open={open}
      onOpenChange={onOpenChange}
      branch={branch}
      paths={paths}
      chosen={chosen}
      onToggle={(path) =>
        setUnchecked((current) => {
          const next = new Set(current);
          if (!next.delete(path)) next.add(path);
          return next;
        })
      }
      message={message}
      onMessage={(text) => {
        edits.current += 1;
        setMessage(text);
      }}
      suggesting={chosen.size > 0 && (again || answered?.key !== chosenKey)}
      suggestNote={!again && answered?.key === chosenKey && answered.failed ? "Could not suggest a message. Write your own." : null}
      onSuggestAgain={() => {
        setAgain(true);
        suggest([...chosen], true);
      }}
      runActive={runActive}
      committing={committing}
      onCommit={commit}
      failure={failure}
      error={error}
    />
  );
}
