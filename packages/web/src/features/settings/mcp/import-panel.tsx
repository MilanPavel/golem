import {
  applyParams,
  importItems,
  initialPicks,
  missingRefsOf,
  candidateNotes,
  candidateTarget,
  pickableKeys,
  scanSummary,
  type ImportItem,
  type ImportSource,
} from "@golem/view";
import { useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { McpImportApplyResult, McpImportScanResult } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { Input } from "../../../ui/input.tsx";
import { Textarea } from "../../../ui/textarea.tsx";
import { BrandIcon, brandPath } from "./brand-icon.tsx";

type Props = {
  sessionId: string | null;
  onImported: (names: string[]) => void;
  /** The person is finished with the result; the page goes back to the installed servers. */
  onDone: () => void;
};

/** The Import tab: the servers other apps have, with nothing picked to start. Pick, rename any, fill what they only named, and add. */
export function ImportPanel({ sessionId, onImported, onDone }: Props) {
  return <Body sessionId={sessionId} onDone={onDone} onImported={onImported} />;
}

type Stage =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; scan: McpImportScanResult; picked: ReadonlySet<string> }
  | { kind: "done"; result: McpImportApplyResult };

function Body({ sessionId, onDone, onImported }: Props) {
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
        setStage({ kind: "ready", scan: scanned, picked: initialPicks() });
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
        setStage({ kind: "ready", scan: scanned, picked: initialPicks() });
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
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Import finished</h3>
        <p className="text-sm text-muted">{stage.result.added.length === 0 ? "Nothing was added." : `Added ${stage.result.added.length} ${stage.result.added.length === 1 ? "server" : "servers"}.`}</p>
        <ul aria-label="Added" className="flex flex-col gap-1 font-mono text-sm">
          {stage.result.added.map((server) => (
            <li key={server.name}>
              {server.name} · {server.state}
            </li>
          ))}
        </ul>
        {failed.length === 0 ? null : (
          <ul aria-label="Not added" role="alert" className="flex flex-col gap-1 text-sm text-deny">
            {failed.map((failure) => (
              <li key={failure.key} className="wrap-anywhere">
                Not added: {failure.error}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          {failed.length === 0 ? null : <Button onClick={() => scan(null)}>Look again</Button>}
          <Button kind="primary" autoFocus onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  function pick(keys: readonly string[], on: boolean): void {
    setStage((now) => {
      if (now.kind !== "ready") return now;
      const next = new Set(now.picked);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return { ...now, picked: next };
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">golem reads the config files of Claude Desktop, Claude Code, Cursor, VS Code, and Windsurf. It never changes them. A token goes to your Keychain.</p>
      {stage.kind === "loading" ? <p className="font-mono text-sm text-muted">looking…</p> : null}
      {stage.kind === "failed" ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-deny">
            {stage.message}
          </p>
          <Button size="sm" onClick={() => scan(null)}>
            Try again
          </Button>
        </div>
      ) : null}
      {stage.kind === "ready" ? (
        <ImportListView
          sources={stage.scan.sources}
          picked={stage.picked}
          names={names}
          values={values}
          busy={busy}
          onPick={pick}
          onName={(key, value) => setNames((now) => ({ ...now, [key]: value }))}
          onValue={(ref, value) => setValues((now) => ({ ...now, [ref]: value }))}
          onImport={() => void apply(stage.scan, stage.picked)}
        />
      ) : null}
      <details className="text-sm">
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
        <p role="alert" className="text-sm text-deny">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * What a scan found, grouped by the app that has it: one line each (check, name, what it runs, notes),
 * Select all per group, and a footer that stays in view with Import N. Pure: the panel above owns the state.
 */
export function ImportListView({
  sources,
  picked,
  names,
  values,
  busy,
  onPick,
  onName,
  onValue,
  onImport,
}: {
  sources: readonly ImportSource[];
  picked: ReadonlySet<string>;
  names: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
  busy: boolean;
  onPick: (keys: readonly string[], on: boolean) => void;
  onName: (key: string, name: string) => void;
  onValue: (ref: string, value: string) => void;
  onImport: () => void;
}) {
  const items = importItems(sources);
  const refs = missingRefsOf(items, picked);
  const count = picked.size;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{scanSummary(sources)}</p>
      {sources.length === 0 ? <p className="text-sm text-muted">No config files of other apps were found.</p> : null}
      {sources.map((source) => {
        const own = items.filter((item) => item.source === source);
        const keys = pickableKeys(own);
        const all = keys.length > 0 && keys.every((key) => picked.has(key));
        return (
          <section key={source.id + (source.path ?? "")} aria-label={source.label} className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-2">
            <div className="flex flex-wrap items-baseline gap-x-3 px-1">
              <h3 className="text-sm font-semibold">{source.label}</h3>
              {source.path == null ? null : (
                <span className="min-w-0 truncate font-mono text-xs text-muted" title={source.path}>
                  {source.path}
                </span>
              )}
              {own.length === 0 ? null : <span className="text-xs text-muted">{own.length} found</span>}
              {keys.length === 0 ? null : (
                <Button size="sm" className="ml-auto" aria-label={`${all ? "Clear" : "Select all"} in ${source.label}`} onClick={() => onPick(keys, !all)}>
                  {all ? "Clear" : "Select all"}
                </Button>
              )}
            </div>
            {source.error == null ? null : <p className="px-1 text-sm text-deny">{source.error}</p>}
            <ul className="flex flex-col">
              {own.map((item) => (
                <Row
                  key={item.key}
                  item={item}
                  checked={picked.has(item.key)}
                  name={names[item.key] ?? item.candidate.name}
                  onToggle={(on) => onPick([item.key], on)}
                  onName={(value) => onName(item.key, value)}
                />
              ))}
            </ul>
            {(source.skipped ?? []).map((line) => (
              <p key={line} className="px-1 text-xs text-muted wrap-anywhere">
                Skipped {line}
              </p>
            ))}
          </section>
        );
      })}
      {refs.length === 0 ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">Values the other app only named</legend>
          {refs.map((ref) => (
            <label key={ref} className="flex flex-col gap-1 text-sm">
              <span className="font-mono text-xs">{ref}</span>
              <Input
                type="password"
                value={values[ref] ?? ""}
                onChange={(event) => onValue(ref, event.target.value)}
                placeholder="leave empty to set it later"
                autoComplete="off"
                aria-label={`Value for ${ref}`}
              />
            </label>
          ))}
        </fieldset>
      )}
      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-line bg-bg px-1 py-2">
        <span role="status" aria-live="polite" className="font-mono text-xs text-muted">
          {count} selected
        </span>
        <Button kind="primary" className="ml-auto" disabled={busy || count === 0} onClick={onImport}>
          {count === 0 ? "Import" : `Import ${count}`}
        </Button>
      </div>
    </div>
  );
}

function Row({ item, checked, name, onToggle, onName }: { item: ImportItem; checked: boolean; name: string; onToggle: (on: boolean) => void; onName: (name: string) => void }) {
  const { candidate } = item;
  const notes = candidateNotes(candidate);
  const target = candidateTarget(candidate);
  const same = candidate.already_same === true;
  const [renaming, setRenaming] = useState(false);
  return (
    <li className={cn("flex flex-col gap-0.5 rounded-md px-1 py-1.5 hover:bg-bg", same && "opacity-70")}>
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={checked} disabled={same} onChange={(event) => onToggle(event.target.checked)} aria-label={`Import ${candidate.original_name}`} />
        <span className="flex w-48 shrink-0 items-center gap-2">
          {brandPath(candidate.original_name) === null ? null : <BrandIcon id={candidate.original_name} size="sm" />}
          {renaming ? (
            <Input
              aria-label={`Name of ${candidate.original_name}`}
              value={name}
              onChange={(event) => onName(event.target.value)}
              onBlur={() => setRenaming(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(false);
                }
              }}
              autoFocus
              className="min-w-0 font-mono"
              spellCheck={false}
              autoComplete="off"
            />
          ) : (
            <>
              <span className="min-w-0 truncate font-mono text-sm">{name}</span>
              {same ? null : (
                <button
                  type="button"
                  aria-label={`Rename ${candidate.original_name}`}
                  onClick={() => setRenaming(true)}
                  className="shrink-0 rounded-xs px-1 text-xs text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2"
                >
                  <span aria-hidden="true">✎</span>
                </button>
              )}
            </>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={target}>
          {target}
        </span>
        {notes.length === 0 ? null : <span className="shrink-0 text-xs text-muted">{notes.join(", ")}</span>}
      </div>
      {(candidate.warnings ?? []).map((warning) => (
        <span key={warning} className="pl-7 text-xs text-wait wrap-anywhere">
          ! {warning}
        </span>
      ))}
    </li>
  );
}
