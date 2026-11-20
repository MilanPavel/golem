import { planFooter, planOfCall, PROPOSE_PLAN_TOOL, type PlanStepView, type ToolBlock } from "@golem/view";
import { useState } from "react";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";

/** The `propose_plan` calls of a turn that have a whole plan: the ones drawn as a card. */
export function isPlanCard(tool: ToolBlock): boolean {
  return tool.name === PROPOSE_PLAN_TOOL && tool.status !== "failed" && planOfCall(tool.args) !== null;
}

/** What the card's buttons do. Both answer with a promise, so the card can say when one failed. */
export type PlanActions = {
  /** The call of the newest plan while it waits for an answer, else null. */
  open: string | null;
  onBuild: () => Promise<void>;
  onChange: () => void;
};

/**
 * A plan as a card: the title, the numbered steps with their files, and the footer. While the plan
 * waits for an answer it has "Build it" and "Change the plan…". An answered card has no buttons.
 */
export function PlanCardView({
  title,
  steps,
  actions,
}: {
  title: string;
  steps: readonly PlanStepView[];
  /** Null for an answered card. */
  actions: { onBuild: () => Promise<void>; onChange: () => void } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function build(): Promise<void> {
    if (actions === null) return;
    setBusy(true);
    setError(null);
    try {
      await actions.onBuild();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the build.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="group" aria-label={`Plan: ${title}`} data-plan-card data-answered={actions === null} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface px-3.5 py-3">
      <h3 className="text-sm font-semibold text-ink">
        <span aria-hidden="true" className="mr-1.5 text-clay-ink">◇</span>
        Plan: {title}
      </h3>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm text-ink marker:text-muted">
        {steps.map((step, index) => (
          <li key={index}>
            {step.text}
            {step.files.length === 0 ? null : (
              <span className="ml-2 text-meta text-muted">{step.files.map((file, at) => (<span key={file}>{at === 0 ? null : " · "}<Code tone="muted">{file}</Code></span>))}</span>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {actions === null ? null : (
          <>
            <Button kind="primary" size="sm" disabled={busy} onClick={() => void build()}>
              Build it
            </Button>
            <Button size="sm" disabled={busy} onClick={actions.onChange}>
              Change the plan…
            </Button>
          </>
        )}
        <span className="text-meta text-muted">{planFooter({ steps })}</span>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </div>
  );
}

/** The card of one `propose_plan` call. It has buttons only while this call is the plan that waits. */
export function PlanCard({ tool, plan }: { tool: ToolBlock; plan: PlanActions | undefined }) {
  const parsed = planOfCall(tool.args);
  if (parsed === null) return null;
  const waiting = plan !== undefined && plan.open === tool.callId;
  return <PlanCardView title={parsed.title} steps={parsed.steps} actions={waiting ? { onBuild: plan.onBuild, onChange: plan.onChange } : null} />;
}
