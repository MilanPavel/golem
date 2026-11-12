import { toolsNeeds, toolsStatusText, type ToolsRow, type ToolsState } from "@golem/view";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Input } from "../../ui/input.tsx";
import { PullBar } from "../models/index.ts";
import { MarkGlyph } from "./mark-glyph.tsx";
import type { ToolsLog } from "./use-tools.ts";

export type ToolsOfferViewProps = {
  state: ToolsState;
  /** The token typed in the field under the offer. */
  draft: string;
  logs: Readonly<Record<string, ToolsLog>>;
  onDraft: (text: string) => void;
  onTick: (id: string) => void;
  /** `Add N`. */
  onStart: () => void;
  /** `Skip`, from the offer: nothing is added. */
  onSkip: () => void;
  /** `Continue`, while rows may still run. */
  onContinue: () => void;
  /** A failed row tries again, with a new token when it was pasted. */
  onRetry: (id: string, token: string | null) => void;
  onSkipRow: (id: string) => void;
  onLog: (id: string) => void;
};

const NEEDS_INSTALL = "installed for you";

function runtimeName(runtime: "node" | "uv"): string {
  return runtime === "node" ? "Node" : "uv";
}

/** The rows the click on Add would really add: ticked, and for a server that needs a token, given one (or one being typed). */
export function toolsTickedCount(state: ToolsState, draft = ""): number {
  return state.rows.filter((row) => {
    if (row.already) return false;
    if (state.tokenFor === row.id) return draft.trim().length > 0;
    return row.ticked && (!row.needsToken || row.token !== null);
  }).length;
}

function OfferRow({ row, state, draft, onDraft, onTick }: { row: ToolsRow; state: ToolsState } & Pick<ToolsOfferViewProps, "draft" | "onDraft" | "onTick">) {
  const field = useId();
  const input = useRef<HTMLInputElement>(null);
  const open = state.phase === "token" && state.tokenFor === row.id;
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const needs = row.already ? [] : toolsNeeds(row);
  const note = needs.map((text) => (text.startsWith("needs a ") ? text : `${text} · ${NEEDS_INSTALL}`));
  return (
    <li className="flex flex-col gap-1.5">
      <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5", row.already && "cursor-default")}>
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-clay"
          checked={row.already || row.ticked || open}
          disabled={row.already}
          onChange={() => {
            onTick(row.id);
          }}
        />
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
          <span className="font-semibold">{row.title}</span>
          <span className="text-sm text-muted">{row.description}</span>
          {row.already ? (
            <span className="font-mono text-xs text-faint">added</span>
          ) : note.length === 0 ? null : (
            <span className="font-mono text-xs text-faint">{note.join(" · ")}</span>
          )}
        </span>
      </label>
      {open ? (
        <div className="ml-6 flex flex-col gap-1.5 rounded-md border border-dashed border-line-strong px-3 py-2.5">
          <label htmlFor={field} className="font-semibold">
            {row.title} token
          </label>
          <Input
            ref={input}
            id={field}
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(event) => {
              onDraft(event.target.value);
            }}
          />
          <p className="text-sm text-muted">
            {row.tokenHint === null ? "" : `${row.tokenHint} · `}Stored in your macOS Keychain, never in a file. Empty skips {row.title}.
          </p>
        </div>
      ) : null}
    </li>
  );
}

function Dash({ word }: { word: string }) {
  return (
    <span className="grid size-4 shrink-0 place-items-center font-mono text-sm leading-none text-faint">
      <span aria-hidden="true">–</span>
      <span className="sr-only">{word}: </span>
    </span>
  );
}

function RowMark({ row }: { row: ToolsRow }) {
  switch (row.status.kind) {
    case "added":
      return <MarkGlyph mark="ok" />;
    case "failed":
      return <MarkGlyph mark="fail" />;
    case "installing":
    case "adding":
      return <MarkGlyph mark="spin" />;
    case "skipped":
      return <Dash word="skipped" />;
    default:
      return <Dash word="waiting" />;
  }
}

/** The share of a download that the newest output line gives, when it gives one. */
function tailShare(tail: string): number | null {
  const found = [...tail.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].at(-1)?.[1];
  return found === undefined ? null : Math.min(1, Number(found) / 100);
}

function NewToken({ row, onRetry }: { row: ToolsRow; onRetry: ToolsOfferViewProps["onRetry"] }) {
  const field = useId();
  const [token, setToken] = useState("");
  return (
    <form
      className="flex basis-full flex-wrap items-center gap-2 pl-7"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const given = token;
        setToken("");
        onRetry(row.id, given);
      }}
    >
      <label htmlFor={field} className="sr-only">
        New {row.title} token
      </label>
      <Input id={field} type="password" autoComplete="off" value={token} onChange={(event) => { setToken(event.target.value); }} className="w-64" />
      <Button type="submit" size="sm" disabled={token.trim().length === 0}>
        Try again
      </Button>
    </form>
  );
}

function RunCard({ row, log, onRetry, onSkipRow, onLog }: { row: ToolsRow; log: ToolsLog | undefined } & Pick<ToolsOfferViewProps, "onRetry" | "onSkipRow" | "onLog">) {
  const [pasting, setPasting] = useState(false);
  const status = row.status;
  const failed = status.kind === "failed";
  const text = status.kind === "installing" ? `installing ${runtimeName(status.runtime)}` : toolsStatusText(row);
  return (
    <li className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border border-line bg-surface px-4 py-3 text-left", failed && "border-deny")}>
      <span className="mt-0.5">
        <RowMark row={row} />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-semibold">{row.title}</p>
        <p className={cn("text-sm break-words text-muted", failed && "text-deny")}>{text}</p>
        {status.kind === "installing" ? (
          <PullBar label={`Installing ${runtimeName(status.runtime)}`} share={tailShare(status.tail)} text={status.tail} />
        ) : null}
      </div>
      {failed ? (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {row.needsToken ? (
            <Button
              size="sm"
              aria-expanded={pasting}
              onClick={() => {
                setPasting(!pasting);
              }}
            >
              Paste a new token
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                onRetry(row.id, null);
              }}
            >
              Try again
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              onLog(row.id);
            }}
          >
            Show the log
          </Button>
          <Button
            size="sm"
            aria-label={`Skip ${row.title}`}
            onClick={() => {
              onSkipRow(row.id);
            }}
          >
            Skip
          </Button>
        </div>
      ) : null}
      {failed && pasting ? <NewToken row={row} onRetry={(id, token) => { setPasting(false); onRetry(id, token); }} /> : null}
      {failed && log !== undefined ? (
        <div className="flex basis-full flex-col gap-2 pl-7">
          {log.kind === "loading" ? <p role="status" className="text-sm text-muted">Reading the log…</p> : null}
          {log.kind === "error" ? <p role="alert" className="text-sm text-deny">{log.text}</p> : null}
          {log.kind === "lines" ? (
            <pre
              tabIndex={0}
              aria-label={`${row.title} log`}
              className="max-h-48 overflow-auto rounded-md bg-code-bg p-2 font-mono text-xs whitespace-pre-wrap text-ink outline-offset-2 outline-clay focus-visible:outline-2"
            >
              {log.lines.length === 0 ? "The log is empty." : log.lines.join("\n")}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The Tools panel, drawn from the pure model of `@golem/view`: the starter servers to tick, the
 * token field under GitHub, and each server's progress while it is added. `/welcome` and
 * Settings → Setup both draw it, so they say the same things.
 */
export function ToolsOfferView({ state, draft, logs, onDraft, onTick, onStart, onSkip, onContinue, onRetry, onSkipRow, onLog }: ToolsOfferViewProps) {
  const guided = state.mode === "guided";
  if (state.phase === "run") {
    const asked = state.rows.filter((row) => !row.already && row.status.kind !== "idle");
    const shown = state.rows.filter((row) => row.status.kind !== "idle");
    const installing = state.rows.find((row) => row.status.kind === "installing");
    const running = state.rows.some((row) => ["waiting", "installing", "adding"].includes(row.status.kind));
    const keeps =
      installing?.status.kind === "installing" ? `${runtimeName(installing.status.runtime)} keeps installing if you go on.` : "The rest finish in the background.";
    return (
      <div className="flex w-full flex-col gap-4 text-left">
        <h2 className={cn(guided ? "font-prose text-2xl font-normal tracking-tight text-balance" : "text-base font-semibold")}>
          Adding {asked.length} tool{asked.length === 1 ? "" : "s"}
        </h2>
        <ul aria-label="Tools being added" className="flex list-none flex-col gap-2 p-0">
          {shown.map((row) => (
            <RunCard key={row.id} row={row} log={logs[row.id]} onRetry={onRetry} onSkipRow={onSkipRow} onLog={onLog} />
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button kind="ink" onClick={onContinue}>
            {guided ? "Continue" : "Done"}
          </Button>
          {running ? <span className="text-sm text-muted">{keeps}</span> : null}
        </div>
      </div>
    );
  }
  const count = toolsTickedCount(state, draft);
  const added = state.rows.filter((row) => row.already).length;
  return (
    <form
      className="flex w-full flex-col gap-3 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        onStart();
      }}
    >
      {guided ? (
        <>
          <h2 className="font-prose text-2xl font-normal tracking-tight text-balance">Give golem some tools?</h2>
          <p className="-mt-1 text-muted">They cost nothing until a chat turns one on. You can add more in Settings.</p>
        </>
      ) : (
        <h3 className="text-base font-semibold">
          Tools · {added} server{added === 1 ? "" : "s"}
        </h3>
      )}
      <ul aria-label="Starter tools" className="flex list-none flex-col gap-1.5 p-0">
        {state.rows.map((row) => (
          <OfferRow key={row.id} row={row} state={state} draft={draft} onDraft={onDraft} onTick={onTick} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="submit" kind="ink" disabled={count === 0}>
          {count === 0 ? "Add" : `Add ${count}`}
        </Button>
        <Button onClick={onSkip}>{guided ? "Skip" : "Cancel"}</Button>
      </div>
    </form>
  );
}
