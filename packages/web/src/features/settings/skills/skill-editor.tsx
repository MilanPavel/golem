import { changedOnDisk, problemLine, problemLines } from "@golem/view";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { usePageActions } from "../../../store/page-context.tsx";
import { skillErrorText, type ListedSkill, type SkillIssue } from "../../../store/skills.ts";
import { Button } from "../../../ui/button.tsx";
import { CodeEditor } from "../config/code-editor.tsx";

const CHECK_MS = 400;

/** What the daemon said about the text in the box: its problems, or why it could not check. */
type Check = { text: string; errors: readonly SkillIssue[]; warnings: readonly SkillIssue[]; stale: boolean } | { text: string; failed: string };

/**
 * The `SKILL.md` of one skill in the code editor: checked as you type (`dry_run`, nothing written),
 * saved with the `mtime_ns` it was read at. A bundled skill is shown read-only.
 */
export function SkillEditor({ skill, cwd, onCopy }: { skill: ListedSkill; cwd: string | null; onCopy: () => void }) {
  const actions = usePageActions();
  const [round, setRound] = useState(0);
  const file = useQuery({
    queryKey: ["skill.read", skill.name, cwd, skill.path, round],
    queryFn: () => actions.readSkill(skill.name, cwd),
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const [saved, setSaved] = useState(false);

  if (skill.shadowed_by) {
    return <p className="text-sm text-muted">This skill is hidden by another of the same name, so its file is not read here. Open the one that hides it.</p>;
  }
  if (file.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {skillErrorText(file.error, "Could not read the file.")}
        </p>
        <Button size="sm" onClick={() => void file.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (file.data === undefined) return <p className="font-mono text-sm text-muted">asking the daemon…</p>;
  return (
    <Editor
      key={`${file.data.path}:${round}`}
      skill={skill}
      cwd={cwd}
      path={file.data.path}
      original={file.data.text}
      base={file.data.mtime_ns}
      bundled={file.data.source === "bundled"}
      saved={saved}
      onSaved={() => {
        setSaved(true);
        setRound((now) => now + 1);
      }}
      onReload={() => {
        setSaved(false);
        setRound((now) => now + 1);
      }}
      onCopy={onCopy}
    />
  );
}

function Editor({
  skill,
  cwd,
  path,
  original,
  base,
  bundled,
  saved,
  onSaved,
  onReload,
  onCopy,
}: {
  skill: ListedSkill;
  cwd: string | null;
  path: string;
  original: string;
  base: number;
  bundled: boolean;
  saved: boolean;
  onSaved: () => void;
  onReload: () => void;
  onCopy: () => void;
}) {
  const actions = usePageActions();
  const [text, setText] = useState(original);
  const [check, setCheck] = useState<Check | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const turn = useRef(0);
  const dirty = text !== original;

  // The daemon checks the text 400 ms after the last key (at once when it is the file as read), and writes nothing.
  useEffect(() => {
    if (bundled) return;
    const mine = ++turn.current;
    const timer = setTimeout(
      () => {
        actions.writeSkill({ path, text, baseMtimeNs: base, cwd, dryRun: true }).then(
          (result) => {
            if (mine !== turn.current) return;
            setCheck({ text, errors: result.errors ?? [], warnings: result.warnings ?? [], stale: !result.ok && changedOnDisk(result.errors ?? []) });
          },
          (error: unknown) => {
            if (mine === turn.current) setCheck({ text, failed: skillErrorText(error, "Could not check the text.") });
          },
        );
      },
      dirty ? CHECK_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [actions, base, bundled, cwd, dirty, path, text]);

  // A check of an older text says nothing about this one.
  const current = check !== null && check.text === text ? check : null;
  const errors = current !== null && "errors" in current && !current.stale ? current.errors : [];
  const warnings = current !== null && "warnings" in current && !current.stale ? current.warnings : [];
  const failedCheck = current !== null && "failed" in current ? current.failed : null;
  const stale = conflict || (current !== null && "stale" in current && current.stale);
  const checking = !bundled && current === null;

  async function save(): Promise<void> {
    setSaving(true);
    setFailure(null);
    try {
      const result = await actions.writeSkill({ path, text, baseMtimeNs: base, cwd, dryRun: false });
      if (result.ok) {
        onSaved();
        return;
      }
      if (changedOnDisk(result.errors ?? [])) setConflict(true);
      else setCheck({ text, errors: result.errors ?? [], warnings: result.warnings ?? [], stale: false });
    } catch (error) {
      setFailure(skillErrorText(error, "Could not save the file."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {saved && !dirty ? (
        <p role="status" className="font-mono text-xs text-allow">
          Saved. The registry reloaded.
        </p>
      ) : null}
      {stale ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-deny px-3 py-2 text-sm">
          <p>The file changed on disk since you opened it. Nothing was saved.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={onReload}>
              Reload the file
            </Button>
            {conflict ? (
              <Button size="sm" onClick={() => setConflict(false)}>
                Keep editing
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted">Reloading drops what you typed.</p>
        </div>
      ) : null}
      <CodeEditor
        value={text}
        onChange={setText}
        marked={problemLines(errors)}
        label={`${skill.name} SKILL.md`}
        language="markdown"
        readOnly={bundled}
        className="h-72"
      />
      {errors.length > 0 ? (
        <ul aria-label="Errors" role="alert" className="flex flex-col gap-1 rounded-md border border-deny bg-deny-soft px-3 py-2 font-mono text-xs text-deny">
          {errors.map((issue, at) => (
            <li key={at} className="wrap-anywhere">
              {problemLine(issue)}
            </li>
          ))}
        </ul>
      ) : null}
      {warnings.length > 0 ? (
        <ul aria-label="Warnings" className="flex flex-col gap-1 font-mono text-xs text-wait">
          {warnings.map((issue, at) => (
            <li key={at} className="wrap-anywhere">
              {problemLine(issue)}
            </li>
          ))}
        </ul>
      ) : null}
      {failedCheck === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {failedCheck}
        </p>
      )}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {failure}
        </p>
      )}
      {bundled ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="primary" size="sm" onClick={onCopy}>
            Copy to Yours
          </Button>
          <span className="text-xs text-muted">Bundled with golem: copy it to Yours to change it.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            kind="primary"
            size="sm"
            disabled={!dirty || checking || errors.length > 0 || failedCheck !== null || stale || saving}
            onClick={() => void save()}
          >
            Save
          </Button>
          <Button size="sm" disabled={!dirty} onClick={() => setText(original)}>
            Revert
          </Button>
          <span role="status" aria-live="polite" className="ml-auto font-mono text-xs text-muted">
            {dirty ? (checking ? "checking…" : "Not saved · the registry reloads on save") : "No changes"}
          </span>
        </div>
      )}
    </div>
  );
}
