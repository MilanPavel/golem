import { helperCountWords } from "@golem/view";
import { useSession, useSessionList } from "../../store/page-context.tsx";
import { sessionPath } from "../../store/router.ts";
import { Link } from "../../ui/link.tsx";
import { openHelper } from "../chat/helper-open.ts";
import { useNow } from "../sessions/use-now.ts";
import { StepsView, stepsBatches, type StepsBatch } from "../workbench/index.ts";

export type LeadRunProps = {
  title: string;
  /** The model the lead runs on, when it is at hand. */
  model?: string | null;
  /** The lead's `helpers_running` and `helpers_waiting`. */
  running: number | null | undefined;
  waiting: number | null | undefined;
  /** The step lists of its batches, newest first. */
  batches: readonly StepsBatch[];
  href: string;
  /** The lead's session id: a helper opened from here belongs to this chat. */
  leadId?: string;
  onNavigate: (path: string) => void;
};

/**
 * A lead in Runs: its row (title, model, how many helpers work) and under it the same step list the
 * Steps tab draws, at full width. Pure: the lists come built.
 */
export function LeadRun({ title, model = null, running, waiting, batches, href, leadId, onNavigate }: LeadRunProps) {
  const words = helperCountWords(running, waiting);
  return (
    <section aria-label={`Helpers of ${title}`} data-lead-run className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 items-baseline justify-between gap-x-3">
        <Link href={href} onNavigate={onNavigate} className="min-w-0 truncate text-sm font-medium outline-offset-2 outline-clay hover:underline focus-visible:outline-2">
          {title}
        </Link>
        <span className="flex items-baseline gap-3 whitespace-nowrap font-mono text-xs text-muted">
          {model === null ? null : <span className="text-faint">{model}</span>}
          <span data-helper-count>{words ?? "no helpers working"}</span>
        </span>
      </div>
      <StepsView
        batches={batches}
        onOpen={(open) => {
          // No chat is in view here: open the helper for its lead, then go to the lead's chat.
          openHelper({ ...open, ...(leadId === undefined ? {} : { leadId }) });
          onNavigate(href);
        }}
      />
    </section>
  );
}

function LiveLeadRun({ id, title, model, running, waiting, onNavigate }: Omit<LeadRunProps, "batches" | "href" | "leadId"> & { id: string }) {
  const chat = useSession(id, (view) => view.chat);
  const now = useNow(1000);
  return <LeadRun title={title} model={model} running={running} waiting={waiting} batches={stepsBatches(chat, now)} href={sessionPath(id)} leadId={id} onNavigate={onNavigate} />;
}

/** The leads that have helpers at work, each with its step list. Nothing when no lead has. */
export function LiveLeadRuns({ onNavigate }: { onNavigate: (path: string) => void }) {
  const leads = useSessionList().filter((session) => session.parent_session_id == null && ((session.helpers_running ?? 0) > 0 || (session.helpers_waiting ?? 0) > 0));
  if (leads.length === 0) return null;
  return (
    <div data-lead-runs className="flex flex-col gap-3">
      {leads.map((lead) => (
        <LiveLeadRun
          key={lead.session_id}
          id={lead.session_id}
          title={lead.title ?? "Untitled session"}
          model={lead.model_profile}
          running={lead.helpers_running}
          waiting={lead.helpers_waiting}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
