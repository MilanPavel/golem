import {
  contextFillLine,
  contextLevel,
  contextPercent,
  contextShare,
  contextSummary,
  formatTokens,
  formatWindow,
  suggestedAction,
  windowSourceLine,
  type ContextAction,
  type ContextActionId,
  type ContextLevel,
  type WindowSource,
} from "@golem/view";
import { useState } from "react";
import { useNavigate, useSession } from "../../store/page-context.tsx";
import { actionErrorText } from "../../store/errors.ts";
import { inspectPath } from "../../store/router.ts";
import { cn } from "../../ui/cn.ts";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { BAR_CHIP } from "./composer-bar.ts";
import { useContextActions, useRunContextAction } from "./use-context-actions.ts";

const TEXT: Record<ContextLevel, string> = { ok: "text-muted", high: "text-wait", full: "text-deny" };
const FILL: Record<ContextLevel, string> = { ok: "bg-clay", high: "bg-wait", full: "bg-deny" };
const RING: Record<ContextLevel, string> = { ok: "stroke-allow", high: "stroke-wait", full: "stroke-deny" };

/** A small ring that fills clockwise with the share of the window that is used. */
function Ring({ share, level }: { share: number | null; level: ContextLevel }) {
  const length = 2 * Math.PI * 5.5;
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" className="size-4 shrink-0 -rotate-90">
      <circle cx="8" cy="8" r="5.5" fill="none" strokeWidth="2.5" className="stroke-line-strong" />
      {share === null ? null : (
        <circle
          cx="8"
          cy="8"
          r="5.5"
          fill="none"
          strokeWidth="2.5"
          strokeDasharray={`${Math.min(1, share) * length} ${length}`}
          className={RING[level]}
        />
      )}
    </svg>
  );
}

/** What the chip says: the ring, `38.0K / 128K`, and under 500 px the percent alone. */
function ContextText({ used, window, share, estimated, cleared }: { used: number; window: number | null; share: number | null; estimated: boolean; cleared: number }) {
  return (
    <>
      <span className="@max-row-500/comp:hidden">
        <b className="font-medium">{formatTokens(used)}</b>
        {window === null ? null : <span className="@max-row-600/comp:hidden"> / {formatWindow(window)}</span>}
      </span>
      {share === null ? null : (
        <span className="hidden @max-row-500/comp:inline">
          <b className="font-medium">
            {estimated ? "≈" : ""}
            {contextPercent(share)}%
          </b>
        </span>
      )}
      {cleared > 0 ? <span className="@max-row-600/comp:hidden">· {cleared} cleared</span> : null}
    </>
  );
}

/** What the popover of the chip shows and does. */
export type ContextPanel = {
  reserve: number | null;
  source: WindowSource;
  actions: readonly ContextAction[];
  /** Runs a row. The popover shows a spinner on it until this settles, and closes if it resolves. */
  onRun: (id: ContextActionId) => Promise<void>;
  /** The old behaviour of the chip: open the trace on the last call. */
  onOpenTrace: () => void;
  onOpenChange?: (open: boolean) => void;
};

/** The thin bar: what is used, then the reply reserve at the end. */
function FillBar({ used, window, reserve }: { used: number; window: number | null; reserve: number | null }) {
  const share = contextShare(used, window);
  if (share === null || window === null) return null;
  const percent = contextPercent(share);
  const kept = reserve === null ? 0 : Math.min(100 - percent, Math.round((reserve / window) * 100));
  return (
    <div role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="flex h-1.5 w-full overflow-hidden rounded-full bg-line-strong">
      <div className={cn("h-full", FILL[contextLevel(used, window)])} style={{ width: `${percent}%` }} />
      <div className="ml-auto h-full bg-line" style={{ width: `${kept}%` }} />
    </div>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="size-3 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-clay" />;
}

/** The rows of the popover. A disabled row says why where its cost would be. */
function Rows({ panel, suggested, running, onRun }: { panel: ContextPanel; suggested: ContextActionId | null; running: ContextActionId | null; onRun: (id: ContextActionId) => void }) {
  return (
    <ul aria-label="Actions" className="m-0 flex list-none flex-col gap-1 p-0">
      {panel.actions.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            disabled={!row.enabled || running !== null}
            aria-busy={running === row.id}
            onClick={() => onRun(row.id)}
            className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2 disabled:cursor-default disabled:hover:bg-transparent"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("flex items-baseline gap-2 text-sm", row.enabled ? "text-ink" : "text-faint")}>
                {row.label}
                {suggested === row.id ? <span className="rounded-full bg-clay-soft px-1.5 text-meta text-clay-ink">suggested</span> : null}
              </span>
              <span className="text-meta text-muted">{row.enabled ? row.consequence : (row.why ?? "")}</span>
            </span>
            {running === row.id ? <Spinner /> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * How full the context is after the latest model call. With a `panel` it is the trigger of a popover:
 * the bar, where the window came from, the actions, and a link to the trace. Without one it is a button
 * that calls `onOpen`.
 */
export function ContextChipView({
  used,
  window,
  windowEstimated = false,
  cleared = 0,
  onOpen,
  panel,
}: {
  used: number;
  window: number | null;
  windowEstimated?: boolean;
  /** Tool results golem cleared since the last turn began. */
  cleared?: number;
  onOpen: () => void;
  panel?: ContextPanel;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<ContextActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const share = contextShare(used, window);
  const level = contextLevel(used, window);
  const summary = contextSummary(used, window, windowEstimated);
  const why = windowEstimated && share !== null ? " golem read this window from Ollama. It was not sent." : "";
  const className = cn(BAR_CHIP, "tabular-nums", TEXT[level]);
  const body = (
    <>
      <Ring share={share} level={level} />
      <ContextText used={used} window={window} share={share} estimated={windowEstimated} cleared={cleared} />
    </>
  );
  if (panel === undefined) {
    return (
      <button type="button" title={`Context ${summary}.${why}`} aria-label={`Context ${summary}. Open the trace panel.`} onClick={onOpen} className={className}>
        {body}
      </button>
    );
  }
  const run = (id: ContextActionId) => {
    setError(null);
    setRunning(id);
    panel.onRun(id).then(
      () => {
        setRunning(null);
        setOpen(false);
      },
      (failure: unknown) => {
        setRunning(null);
        setError(actionErrorText(failure, "Could not change the context."));
      },
    );
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
        panel.onOpenChange?.(next);
      }}
    >
      <PopoverTrigger title={`Context ${summary}.${why}`} aria-label={`Context ${summary}. Act on it.`} className={className}>
        {body}
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Context" className="flex w-80 flex-col gap-3 max-sm:w-72">
        <FillBar used={used} window={window} reserve={panel.reserve} />
        <div className="flex flex-col gap-0.5 text-meta text-muted">
          <span>{contextFillLine(used, window, panel.reserve)}</span>
          <span>{windowSourceLine(window, panel.source)}</span>
        </div>
        {panel.actions.length === 0 ? null : <Rows panel={panel} suggested={suggestedAction(panel.actions, used, window)} running={running} onRun={run} />}
        {error === null ? null : (
          <p role="alert" className="text-xs text-deny">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            panel.onOpenTrace();
          }}
          className="cursor-pointer self-start text-xs text-clay-ink underline outline-offset-2 outline-clay focus-visible:outline-2"
        >
          Open the trace
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** The chip for a session, from its live events. Nothing until a model call has reported its input. */
export function ContextChip({ sessionId }: { sessionId: string }) {
  const last = useSession(sessionId, (view) => view.context.last);
  const cleared = useSession(sessionId, (view) => view.chat.clearedNow);
  const navigate = useNavigate();
  const run = useRunContextAction(sessionId);
  const [open, setOpen] = useState(false);
  const read = useContextActions(sessionId, open);
  if (last === null) return null;
  const openTrace = () => navigate(inspectPath(sessionId, last.spanId), { replace: true });
  return (
    <ContextChipView
      used={last.used}
      window={last.window}
      windowEstimated={last.windowEstimated}
      cleared={cleared}
      onOpen={openTrace}
      panel={{
        reserve: read.reserve,
        source: read.source,
        actions: read.actions,
        onRun: run,
        onOpenTrace: openTrace,
        onOpenChange: setOpen,
      }}
    />
  );
}
