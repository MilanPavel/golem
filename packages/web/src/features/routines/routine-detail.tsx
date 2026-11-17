import { useState, type ReactNode } from "react";
import { formatElapsed, lastResultText, routineHeadline, routineState, routineToml, runStatusWords, runWhenText } from "@golem/view";
import { actionErrorText } from "../../store/errors.ts";
import { sessionPath } from "../../store/router.ts";
import type { RoutineInfo, RoutineRunResult, RoutineRunSummary } from "../../store/routines.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { MoreIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/menu.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { RoutineDot, RunDot } from "./routine-dot.tsx";

const LINK = "text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2";

/** A button that is not built yet: it shows disabled, and its tooltip says what it waits for. */
export function PendingButton({ children, reason, kind = "secondary", size = "sm" }: { children: ReactNode; reason: string; kind?: "primary" | "secondary"; size?: "sm" | "md" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md outline-offset-2 outline-clay focus-visible:outline-2">
          <Button kind={kind} size={size} disabled>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function duration(run: RoutineRunSummary): string {
  if (run.status === "running" || run.status === "queued") return run.status;
  if (run.started_at === null || run.started_at === undefined || run.ended_at === null || run.ended_at === undefined) return "";
  const ms = Date.parse(run.ended_at) - Date.parse(run.started_at);
  return Number.isNaN(ms) ? "" : formatElapsed(ms);
}

const TONE: Partial<Record<RoutineRunSummary["status"], string>> = { failed: "text-deny", waiting: "text-wait" };

function HistoryRow({ run, now, onNavigate }: { run: RoutineRunSummary; now: number; onNavigate: (path: string) => void }) {
  const word = runStatusWords(run.status);
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <RunDot status={run.status} word={word} />
      <span className="w-28 shrink-0 text-sm font-medium">{runWhenText(run.started_at ?? run.due_at, now)}</span>
      <span className="w-16 shrink-0 font-mono text-xs text-muted">{duration(run)}</span>
      <span className={cn("min-w-0 flex-1 truncate text-sm", TONE[run.status] ?? "text-ink")}>{lastResultText(run)}</span>
      {run.session_id === null || run.session_id === undefined ? null : (
        <Link href={sessionPath(run.session_id)} onNavigate={onNavigate} className={cn("shrink-0 whitespace-nowrap text-sm", LINK)}>
          Open session<span aria-hidden="true"> ›</span>
        </Link>
      )}
    </li>
  );
}

/** Each firing, newest first: when, how long, how it went, and a link to its session. */
export function History({ runs, now, onNavigate }: { runs: readonly RoutineRunSummary[]; now: number; onNavigate: (path: string) => void }) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted">No runs yet. Run now starts one.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="History" className="divide-y divide-line rounded-lg border border-line bg-surface">
        {runs.map((run) => (
          <HistoryRow key={run.routine_run_id} run={run} now={now} onNavigate={onNavigate} />
        ))}
      </ul>
      <p className="font-mono text-xs text-faint">{runs.length === 1 ? "Showing the last run" : `Showing the last ${runs.length} runs`}</p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 wrap-anywhere">{children}</dd>
    </div>
  );
}

function RemoveDialog({ name, open, onOpenChange, onConfirm }: { name: string; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function confirm(): void {
    setBusy(true);
    setError(null);
    onConfirm().then(
      () => {
        setBusy(false);
        onOpenChange(false);
      },
      (err: unknown) => {
        setBusy(false);
        setError(actionErrorText(err, "Could not remove the routine."));
      },
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogTitle>Remove {name}?</DialogTitle>
        <DialogDescription>It leaves config.toml, and its sessions stay in the list.</DialogDescription>
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-deny">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button kind="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button kind="danger" disabled={busy} onClick={confirm}>
            Remove
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type RoutineDetailProps = {
  routine: RoutineInfo;
  /** Recent runs, newest first. */
  runs: readonly RoutineRunSummary[];
  now: number;
  onNavigate: (path: string) => void;
  /** Fires the routine now. */
  onRun: () => Promise<RoutineRunResult>;
  /** Deletes the routine. Without it, Remove is not offered (a project's routine is edited in its project). */
  onRemove?: () => Promise<void>;
};

type Tab = "history" | "config";

/** One routine in the main area: what it runs, when, its actions, and the History and Config tabs. */
export function RoutineDetail({ routine, runs, now, onNavigate, onRun, onRemove }: RoutineDetailProps) {
  const { config } = routine;
  const [tab, setTab] = useState<Tab>("history");
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const state = routineState(routine);

  function run(): void {
    setRunning(true);
    setError(null);
    setStarted(null);
    onRun().then(
      (result) => {
        setRunning(false);
        setStarted(result.session_id);
      },
      (err: unknown) => {
        setRunning(false);
        setError(actionErrorText(err, "Could not start the routine."));
      },
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap-reverse items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
          <h1 className="flex items-center gap-2 font-sans text-lg font-semibold">
            <RoutineDot state={state} />
            <span className="min-w-0 truncate">{config.name}</span>
          </h1>
          <p className="font-mono text-xs text-muted">{routineHeadline(routine, now)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="primary" size="sm" disabled={running || routine.blocked === true} onClick={run}>
            {running ? "Starting…" : "Run now"}
          </Button>
          <PendingButton reason="Comes with pause">Pause</PendingButton>
          <PendingButton reason="Comes with the routine editor">Edit</PendingButton>
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="More actions">
                <MoreIcon />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => setTab("config")}>Open config</MenuItem>
              {onRemove === undefined ? null : (
                <MenuItem className="text-deny" onSelect={() => setRemoving(true)}>
                  Remove
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </div>
      </header>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {started === null ? null : (
        <p role="status" className="text-sm text-muted">
          Started.{" "}
          <Link href={sessionPath(started)} onNavigate={onNavigate} className={LINK}>
            Open session<span aria-hidden="true"> ›</span>
          </Link>
        </p>
      )}
      {routine.blocked === true ? <p className="text-sm text-muted">This project is not trusted, so its routines are listed and never run.</p> : null}
      <dl className="flex flex-col gap-1.5 text-sm">
        <Fact label="Runs">
          <span className="font-mono text-xs">{config.prompt}</span>
        </Fact>
        <Fact label="Folder">{config.folder ? <span className="font-mono text-xs">{config.folder}</span> : <span className="text-muted">none</span>}</Fact>
        <Fact label="Model">{config.model ? <span className="font-mono text-xs">{config.model}</span> : <span className="text-muted">the default</span>}</Fact>
        <Fact label="MCP servers">
          {config.mcp && config.mcp.length > 0 ? <span className="font-mono text-xs">{config.mcp.join(", ")}</span> : <span className="text-muted">none</span>}
        </Fact>
      </dl>
      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="flex flex-col gap-4">
        <TabsList aria-label={`${config.name} details`}>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>
        <TabsContent value="history">
          <History runs={runs} now={now} onNavigate={onNavigate} />
        </TabsContent>
        <TabsContent value="config" className="flex flex-col gap-2">
          <p className="font-mono text-xs text-faint wrap-anywhere">{routine.path}</p>
          <pre aria-label="Config as TOML" className="overflow-x-auto rounded-lg border border-line bg-surface p-3 font-mono text-xs whitespace-pre-wrap">
            {routineToml(config)}
          </pre>
        </TabsContent>
      </Tabs>
      {onRemove === undefined ? null : <RemoveDialog name={config.name} open={removing} onOpenChange={setRemoving} onConfirm={onRemove} />}
    </div>
  );
}
