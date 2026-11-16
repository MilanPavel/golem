import { bestActions, cutBanner, type ContextAction, type ContextActionId } from "@golem/view";
import { useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { useSession, useTraceSpan } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { useContextActions, useRunContextAction } from "./use-context-actions.ts";

/** The banner above the composer when the model server cut the prompt: the text and the best two actions. */
export function ContextBannerView({
  text,
  actions,
  onRun,
}: {
  text: string;
  actions: readonly ContextAction[];
  onRun: (id: ContextActionId) => Promise<void>;
}) {
  const [running, setRunning] = useState<ContextActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (id: ContextActionId) => {
    setError(null);
    setRunning(id);
    onRun(id).then(
      () => setRunning(null),
      (failure: unknown) => {
        setRunning(null);
        setError(actionErrorText(failure, "Could not change the context."));
      },
    );
  };
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-wait bg-wait-soft px-3 py-2 text-xs text-wait">
      <span className="min-w-0 flex-1">{error ?? text}</span>
      {actions.map((row) => (
        <button
          key={row.id}
          type="button"
          title={row.consequence}
          disabled={running !== null}
          aria-busy={running === row.id}
          onClick={() => run(row.id)}
          className="cursor-pointer rounded-full border border-wait px-2.5 py-0.5 font-mono outline-offset-2 outline-clay hover:bg-surface focus-visible:outline-2 disabled:cursor-default disabled:opacity-60"
        >
          {row.label}
        </button>
      ))}
    </div>
  );
}

const selectLast = (view: SessionView) => view.context.last;
const selectBusy = (view: SessionView) => view.chat.busy;
const selectLocal = (view: SessionView) => view.model?.provider === "ollama";

/**
 * Nothing until the last call of a local model was cut. Then the banner, until a clear or a summary
 * changes the context or the next call goes through. Only a local model reads the call for it.
 */
export function ContextBanner({ sessionId }: { sessionId: string }) {
  const last = useSession(sessionId, selectLast);
  const local = useSession(sessionId, selectLocal);
  const busy = useSession(sessionId, selectBusy);
  const run = useRunContextAction(sessionId);
  const span = useTraceSpan(sessionId, local && !busy && last !== null ? last.spanId : null);
  const text = last === null || last.adjusted === true ? null : cutBanner(span.data?.context);
  const read = useContextActions(sessionId, text !== null);
  if (text === null) return null;
  const best = bestActions(read.actions);
  return <ContextBannerView text={text} actions={best} onRun={run} />;
}
