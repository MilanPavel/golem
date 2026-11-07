import { changedOnDisk, problemLine, problemLines, shortPath, unifiedDiff, type RawProblem } from "@golem/view";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { usePageActions } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { CopyCommand } from "../../ui/copy-command.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { DiffModeSwitch, DiffView, useDiffMode } from "../diff/index.ts";
import { CodeEditor } from "./config/code-editor.tsx";
import { configRequestStore } from "./config-request.ts";
import { useSettingsContext } from "./context.ts";

const CHECK_MS = 400;

/** What the daemon said about the text in the box, as it is now. */
type Check = { text: string; problems: readonly RawProblem[]; restart: readonly string[] } | { text: string; failed: string };

/** The config file as text: the user's, or the project's. Checked as you type, shown as a diff, then saved. */
export function ConfigSection() {
  const context = useSettingsContext();
  const sessionId = context?.sessionId ?? null;
  // `/config project` asks for the project's file. The request is read once, when the section opens.
  const [asked] = useState(() => configRequestStore.getSnapshot()?.project ?? false);
  const [chosen, setChosen] = useState<boolean | null>(null);
  // A click on the switch is the person's own choice and wins over the request.
  const project = sessionId !== null && (chosen ?? asked);
  const [round, setRound] = useState(0);
  const actions = usePageActions();
  const file = useQuery({
    queryKey: ["config.raw", project, sessionId, round],
    queryFn: () => actions.getConfigRaw(project, sessionId),
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const [saved, setSaved] = useState<readonly string[] | null>(null);

  // A request is for one visit: leaving the section takes it, so the next visit opens on the user's file.
  useEffect(() => () => configRequestStore.set(null), []);

  function choose(next: boolean): void {
    setChosen(next);
    setSaved(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Which file" className="flex gap-2">
        <Button size="sm" aria-pressed={!project} onClick={() => choose(false)}>
          Yours
        </Button>
        <Button
          size="sm"
          aria-pressed={project}
          disabled={sessionId === null}
          title={sessionId === null ? "Open Settings from a chat to edit its project's file." : undefined}
          onClick={() => choose(true)}
        >
          This project
        </Button>
      </div>
      {file.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-deny">
            {actionErrorText(file.error, "Could not read the file.")}
          </p>
          <Button size="sm" onClick={() => void file.refetch()}>
            Retry
          </Button>
        </div>
      ) : file.data === undefined ? (
        <p className="font-mono text-sm text-muted">asking the daemon…</p>
      ) : (
        <Editor
          key={`${project}:${round}`}
          project={project}
          sessionId={sessionId}
          path={file.data.path}
          exists={file.data.exists}
          original={file.data.text}
          base={file.data.mtime_ns ?? null}
          saved={saved}
          onSaved={(restart) => {
            setSaved(restart);
            setRound((now) => now + 1);
          }}
          onReload={() => {
            setSaved(null);
            setRound((now) => now + 1);
          }}
        />
      )}
    </div>
  );
}

function Editor({
  project,
  sessionId,
  path,
  exists,
  original,
  base,
  saved,
  onSaved,
  onReload,
}: {
  project: boolean;
  sessionId: string | null;
  path: string;
  exists: boolean;
  original: string;
  base: number | null;
  saved: readonly string[] | null;
  onSaved: (restart: readonly string[]) => void;
  onReload: () => void;
}) {
  const actions = usePageActions();
  const [text, setText] = useState(original);
  const [check, setCheck] = useState<Check | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [mode, setMode] = useDiffMode();
  const turn = useRef(0);
  const dirty = text !== original;

  // The daemon checks the text 400 ms after the last key, and writes nothing.
  useEffect(() => {
    if (!dirty) return;
    const mine = ++turn.current;
    const timer = setTimeout(() => {
      actions.setConfigRaw({ text, baseMtimeNs: base, project, dryRun: true }, sessionId).then(
        (result) => {
          if (mine === turn.current) setCheck({ text, problems: result.errors ?? [], restart: result.restart_needed ?? [] });
        },
        (error: unknown) => {
          if (mine === turn.current) setCheck({ text, failed: actionErrorText(error, "Could not check the text.") });
        },
      );
    }, CHECK_MS);
    return () => clearTimeout(timer);
  }, [actions, base, dirty, project, sessionId, text]);

  // A check of an older text says nothing about this one.
  const current = dirty && check !== null && check.text === text ? check : null;
  const problems = current !== null && "problems" in current ? current.problems : [];
  const checking = dirty && current === null;
  const blocked = problems.length > 0;

  async function save(): Promise<void> {
    setSaving(true);
    setFailure(null);
    try {
      const result = await actions.setConfigRaw({ text, baseMtimeNs: base, project, dryRun: false }, sessionId);
      setReviewing(false);
      if (result.ok) {
        onSaved(result.restart_needed ?? []);
        return;
      }
      const errors = result.errors ?? [];
      if (changedOnDisk(errors)) setConflict(true);
      else setCheck({ text, problems: errors, restart: [] });
    } catch (error) {
      setFailure(actionErrorText(error, "Could not save the file."));
      setReviewing(false);
    } finally {
      setSaving(false);
    }
  }

  const diff = unifiedDiff(original, text, shortPath(path, ""));
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-xs text-muted wrap-anywhere">
        {shortPath(path, "")}
        {exists ? "" : " (does not exist yet: saving creates it)"}
      </p>
      {saved === null ? null : (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          <p>Saved.{saved.length === 0 ? "" : ` These settings are read only when the daemon starts: ${saved.join(", ")}.`}</p>
          {saved.length === 0 ? null : <CopyCommand command="golem daemon restart" />}
        </div>
      )}
      {conflict ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-deny px-3 py-2 text-sm">
          <p>The file changed on disk since you opened it. Nothing was saved.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={onReload}>
              Reload the file
            </Button>
            <Button size="sm" onClick={() => setConflict(false)}>
              Keep editing
            </Button>
          </div>
          <p className="text-xs text-muted">Reloading drops what you typed.</p>
        </div>
      ) : null}
      <CodeEditor value={text} onChange={setText} marked={problemLines(problems)} label="Config file text" />
      <p role="status" aria-live="polite" className="min-h-5 font-mono text-xs text-muted">
        {!dirty ? "no changes" : checking ? "checking…" : current !== null && "failed" in current ? current.failed : blocked ? `${problems.length} ${problems.length === 1 ? "problem" : "problems"}` : "✔ valid"}
      </p>
      {blocked ? (
        <ul aria-label="Problems" className="flex flex-col gap-1 font-mono text-xs text-deny">
          {problems.map((problem, at) => (
            <li key={at} className="wrap-anywhere">
              {problemLine(problem)}
            </li>
          ))}
        </ul>
      ) : null}
      {current !== null && "restart" in current && current.restart.length > 0 ? (
        <p className="text-xs text-muted">Saving changes settings that are read only when the daemon starts: {current.restart.join(", ")}.</p>
      ) : null}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {failure}
        </p>
      )}
      <div className="flex gap-2">
        <Button kind="primary" disabled={!dirty || blocked || checking || (current !== null && "failed" in current)} onClick={() => setReviewing(true)}>
          Review changes
        </Button>
        <Button disabled={!dirty} onClick={() => setText(original)}>
          Discard changes
        </Button>
      </div>
      <Dialog open={reviewing} onOpenChange={setReviewing}>
        <DialogContent className="max-h-screen max-w-3xl overflow-y-auto">
          <DialogTitle>Save {shortPath(path, "")}?</DialogTitle>
          <DialogDescription>This is what changes in the file.</DialogDescription>
          <div className="mt-3 flex justify-end">
            <DiffModeSwitch mode={mode} onChange={setMode} />
          </div>
          <div className="mt-2 overflow-x-auto">
            <DiffView diff={diff} mode={mode} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button autoFocus onClick={() => setReviewing(false)}>
              Keep editing
            </Button>
            <Button kind="primary" disabled={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
