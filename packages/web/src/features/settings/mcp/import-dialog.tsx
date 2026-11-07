import {
  applyParams,
  candidateNotes,
  candidateTarget,
  importItems,
  initialPicks,
  missingRefsOf,
  scanSummary,
  type ImportItem,
} from "@golem/view";
import { useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { McpImportApplyResult, McpImportScanResult } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog.tsx";
import { Input } from "../../../ui/input.tsx";
import { Textarea } from "../../../ui/textarea.tsx";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  onImported: (names: string[]) => void;
};

/** Brings in the servers other apps have: pick them, rename any, fill what they only named, and add. */
export function ImportDialog({ open, onOpenChange, sessionId, onImported }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-2xl overflow-y-auto">
        <Body sessionId={sessionId} onClose={() => onOpenChange(false)} onImported={onImported} />
      </DialogContent>
    </Dialog>
  );
}

type Stage =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; scan: McpImportScanResult; picked: ReadonlySet<string> }
  | { kind: "done"; result: McpImportApplyResult };

function Body({ sessionId, onClose, onImported }: { sessionId: string | null; onClose: () => void; onImported: (names: string[]) => void }) {
  const actions = usePageActions();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [names, setNames] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const round = useRef(0);

  function scan(source: string | null): void {
    const mine = ++round.current;
    setStage({ kind: "loading" });
    setProblem(null);
    actions.scanMcpImport(sessionId, source).then(
      (scanned) => {
        if (mine !== round.current) return;
        setNames({});
        setValues({});
        setStage({ kind: "ready", scan: scanned, picked: initialPicks(importItems(scanned.sources)) });
      },
      (error: unknown) => {
        if (mine === round.current) setStage({ kind: "failed", message: actionErrorText(error, "Could not look for servers.") });
      },
    );
  }

  useEffect(() => {
    const mine = ++round.current;
    actions.scanMcpImport(sessionId, null).then(
      (scanned) => {
        if (mine !== round.current) return;
        setStage({ kind: "ready", scan: scanned, picked: initialPicks(importItems(scanned.sources)) });
      },
      (error: unknown) => {
        if (mine === round.current) setStage({ kind: "failed", message: actionErrorText(error, "Could not look for servers.") });
      },
    );
    return () => {
      round.current += 1;
    };
  }, [actions, sessionId]);

  async function apply(scanned: McpImportScanResult, picked: ReadonlySet<string>): Promise<void> {
    const params = applyParams(scanned.scan_id, importItems(scanned.sources), picked, names, values);
    if ("error" in params) {
      setProblem(params.error);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await actions.applyMcpImport(params, sessionId);
      setStage({ kind: "done", result });
      onImported(result.added.map((server) => server.name));
    } catch (error) {
      setProblem(actionErrorText(error, "Could not add the servers."));
    } finally {
      setBusy(false);
    }
  }

  if (stage.kind === "done") {
    const failed = stage.result.failed ?? [];
    return (
      <>
        <DialogTitle>Import finished</DialogTitle>
        <DialogDescription>{stage.result.added.length === 0 ? "Nothing was added." : `Added ${stage.result.added.length} ${stage.result.added.length === 1 ? "server" : "servers"}.`}</DialogDescription>
        <ul aria-label="Added" className="mt-3 flex flex-col gap-1 font-mono text-sm">
          {stage.result.added.map((server) => (
            <li key={server.name}>
              {server.name} · {server.state}
            </li>
          ))}
        </ul>
        {failed.length === 0 ? null : (
          <ul aria-label="Not added" role="alert" className="mt-3 flex flex-col gap-1 text-sm text-deny">
            {failed.map((failure) => (
              <li key={failure.key} className="wrap-anywhere">
                Not added: {failure.error}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {failed.length === 0 ? null : <Button onClick={() => scan(null)}>Look again</Button>}
          <Button kind="primary" autoFocus onClick={onClose}>
            Done
          </Button>
        </div>
      </>
    );
  }

  const items = stage.kind === "ready" ? importItems(stage.scan.sources) : [];
  const picked = stage.kind === "ready" ? stage.picked : new Set<string>();
  const refs = missingRefsOf(items, picked);

  function toggle(key: string, on: boolean): void {
    setStage((now) => {
      if (now.kind !== "ready") return now;
      const next = new Set(now.picked);
      if (on) next.add(key);
      else next.delete(key);
      return { ...now, picked: next };
    });
  }

  return (
    <>
      <DialogTitle>Import servers from other apps</DialogTitle>
      <DialogDescription>
        golem reads the config files of Claude Desktop, Claude Code, Cursor, VS Code, and Windsurf. It never changes them. A token goes to your Keychain.
      </DialogDescription>
      {stage.kind === "loading" ? <p className="mt-3 font-mono text-sm text-muted">looking…</p> : null}
      {stage.kind === "failed" ? (
        <div className="mt-3 flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-deny">
            {stage.message}
          </p>
          <Button size="sm" onClick={() => scan(null)}>
            Try again
          </Button>
        </div>
      ) : null}
      {stage.kind === "ready" ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted">{scanSummary(stage.scan.sources)}</p>
          {stage.scan.sources.length === 0 ? <p className="text-sm text-muted">No config files of other apps were found.</p> : null}
          {stage.scan.sources.map((source) => (
            <section key={source.id + (source.path ?? "")} aria-label={source.label} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                {source.label}{" "}
                {source.path == null ? null : <span className="font-mono text-xs font-normal text-muted wrap-anywhere">({source.path})</span>}
              </h3>
              {source.error == null ? null : <p className="text-sm text-deny">{source.error}</p>}
              <ul className="flex flex-col gap-2">
                {items
                  .filter((item) => item.source === source)
                  .map((item) => (
                    <Row
                      key={item.key}
                      item={item}
                      checked={picked.has(item.key)}
                      name={names[item.key] ?? item.candidate.name}
                      onToggle={(on) => toggle(item.key, on)}
                      onName={(value) => setNames((now) => ({ ...now, [item.key]: value }))}
                    />
                  ))}
              </ul>
              {(source.skipped ?? []).map((line) => (
                <p key={line} className="text-xs text-muted wrap-anywhere">
                  Skipped {line}
                </p>
              ))}
            </section>
          ))}
          {refs.length === 0 ? null : (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold">Values the other app only named</legend>
              {refs.map((ref) => (
                <label key={ref} className="flex flex-col gap-1 text-sm">
                  <span className="font-mono text-xs">{ref}</span>
                  <Input
                    type="password"
                    value={values[ref] ?? ""}
                    onChange={(event) => setValues((now) => ({ ...now, [ref]: event.target.value }))}
                    placeholder="leave empty to set it later"
                    autoComplete="off"
                    aria-label={`Value for ${ref}`}
                  />
                </label>
              ))}
            </fieldset>
          )}
        </div>
      ) : null}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer">Paste JSON or choose a file</summary>
        <div className="mt-2 flex flex-col gap-2">
          <Textarea aria-label="JSON" value={text} onChange={(event) => setText(event.target.value)} className="font-mono" spellCheck={false} placeholder='{"mcpServers": {…}}' />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={text.trim().length === 0} onClick={() => scan(text)}>
              Read it
            </Button>
            <label className="text-xs text-muted">
              <span className="sr-only">Choose a file</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file === undefined) return;
                  void file.text().then((content) => {
                    setText(content);
                    scan(content);
                  });
                }}
              />
            </label>
          </div>
        </div>
      </details>
      {problem === null ? null : (
        <p role="alert" className="mt-3 text-sm text-deny">
          {problem}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        {stage.kind === "ready" ? (
          <Button kind="primary" disabled={busy || picked.size === 0} onClick={() => void apply(stage.scan, stage.picked)}>
            Import {picked.size} {picked.size === 1 ? "server" : "servers"}
          </Button>
        ) : null}
      </div>
    </>
  );
}

function Row({ item, checked, name, onToggle, onName }: { item: ImportItem; checked: boolean; name: string; onToggle: (on: boolean) => void; onName: (name: string) => void }) {
  const { candidate } = item;
  const notes = candidateNotes(candidate);
  return (
    <li className={cn("flex flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2", candidate.already_same === true && !checked && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input type="checkbox" checked={checked} onChange={(event) => onToggle(event.target.checked)} aria-label={`Import ${candidate.original_name}`} />
        <Input
          aria-label={`Name of ${candidate.original_name}`}
          value={name}
          onChange={(event) => onName(event.target.value)}
          disabled={!checked}
          className="w-48 font-mono"
          spellCheck={false}
          autoComplete="off"
        />
        {notes.length === 0 ? null : <span className="text-xs text-muted">{notes.join(", ")}</span>}
      </div>
      <span className="font-mono text-xs text-muted wrap-anywhere">{candidateTarget(candidate)}</span>
      {(candidate.warnings ?? []).map((warning) => (
        <span key={warning} className="text-xs text-wait wrap-anywhere">
          ! {warning}
        </span>
      ))}
    </li>
  );
}
