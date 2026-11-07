import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "../../ui/icons.tsx";
import { useModelList, usePageActions, usePulls, useRoute } from "../../store/page-context.tsx";
import type { PullsSnapshot } from "../../store/pulls.ts";
import { openModelDialog } from "./model-dialog-open.ts";
import { pullSummary, type PullSummary } from "./model-text.ts";
import { PullBar } from "./pull-bar.tsx";

export type PullStatusViewProps = {
  /** What the row says, or null when there is nothing to show. */
  summary: PullSummary | null;
  /** What the polite live region says. It changes only when a download starts, ends, or fails. */
  announcement: string;
  /** The row was pressed: open the model dialog. `trigger` is the row, for focus afterwards. */
  onOpen: (trigger: HTMLElement) => void;
  /** The × of a failed row: forget the failure. */
  onDismiss: (ref: string) => void;
};

/** The sidebar's download row: the title, a bar, and the share and time left; or a failure with a ×. */
export function PullStatusView({ summary, announcement, onOpen, onDismiss }: PullStatusViewProps) {
  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      {summary === null ? null : summary.kind === "failed" ? (
        <div className="flex items-start gap-1 rounded-md border border-line px-2 py-1.5 text-wait">
          <button
            type="button"
            title={summary.text}
            onClick={(event) => onOpen(event.currentTarget)}
            className="min-w-0 flex-1 cursor-pointer rounded-sm text-left text-xs outline-offset-2 outline-clay focus-visible:outline-2"
          >
            <span className="sr-only">{summary.spoken}. Open models</span>
            <span aria-hidden="true">{summary.title}</span>
          </button>
          <button
            type="button"
            aria-label={`Dismiss: ${summary.title}`}
            onClick={() => summary.ref !== undefined && onDismiss(summary.ref)}
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2"
          >
            <CloseIcon aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={(event) => onOpen(event.currentTarget)}
          className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-xs outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2"
        >
          <span className="sr-only">{summary.spoken}. Open models</span>
          <span aria-hidden="true" className="block truncate">
            <span className="text-clay">↓</span> {summary.title}
          </span>
          <span aria-hidden="true" className="block">
            <PullBar label={summary.title} share={summary.share} text={summary.text} />
          </span>
        </button>
      )}
    </>
  );
}

/** The live region's words: what changed since the last snapshot, else what it said before. */
function useAnnouncement(pulls: PullsSnapshot, label: (ref: string) => string): string {
  const [said, setSaid] = useState("");
  const before = useRef<PullsSnapshot | null>(null);
  useEffect(() => {
    const last = before.current;
    before.current = pulls;
    if (last === null) return;
    const name = label;
    for (const ref of pulls.active.keys()) {
      if (!last.active.has(ref)) return setSaid(`Downloading ${name(ref)}`);
    }
    for (const ref of pulls.failed.keys()) {
      if (!last.failed.has(ref)) return setSaid(`Download of ${name(ref)} failed`);
    }
    for (const ref of last.active.keys()) {
      if (!pulls.active.has(ref) && !pulls.failed.has(ref)) return setSaid(`${name(ref)} downloaded`);
    }
  }, [pulls, label]);
  return said;
}

/** The download row on the live page. It opens the model dialog of the session in view, or of none. */
export function PullStatus() {
  const pulls = usePulls();
  const listing = useModelList(pulls.active.size + pulls.failed.size > 0);
  const route = useRoute();
  const page = usePageActions();
  const labels = new Map((listing.data?.models ?? []).map((model) => [model.ref, model.label]));
  const announcement = useAnnouncement(pulls, (ref) => labels.get(ref) ?? ref);
  return (
    <PullStatusView
      summary={pullSummary(pulls.active, pulls.failed, labels)}
      announcement={announcement}
      onOpen={(trigger) => openModelDialog({ sessionId: route.name === "session" ? route.id : null, returnTo: trigger })}
      onDismiss={(ref) => page.forgetPull(ref)}
    />
  );
}
