import { reviewDraftText, reviewTitle, toolAsk } from "@golem/view";
import { useId, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ReviewVerdict, WorkflowReviewInfo } from "../../store/workflows.ts";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Textarea } from "../../ui/textarea.tsx";

export type ReviewCardProps = {
  review: WorkflowReviewInfo;
  /** Answers the review. Rejects with the daemon's reason; the card shows it and stays open. */
  onAnswer: (key: string, verdict: ReviewVerdict, text?: string) => Promise<void>;
};

/** A `run.tool` ask: which tool, what made it ask, and the arguments it would get. Read only: there is nothing to edit but yes or no. */
function ToolAskBody({ tool, args, source }: { tool: string; args: unknown; source: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-muted">
        The run wants to call <Code>{tool}</Code>
        {source === null ? "" : `, because of ${source}`}.
      </p>
      <pre aria-label={`Arguments of ${tool}`} className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-sunken p-2 font-mono text-code text-ink">
        {reviewDraftText(args)}
      </pre>
    </div>
  );
}

/**
 * A review a run waits on. The draft is a field you can change: Approve sends the draft as it was,
 * Edit and approve sends your text, Reject sends a reason. A `run.tool` ask is the same card with the
 * tool and its arguments in place of the field, and no edit.
 */
export function ReviewCard({ review, onAnswer }: ReviewCardProps) {
  const original = reviewDraftText(review.draft);
  const ask = toolAsk(review.draft);
  const title = reviewTitle(review);
  const [text, setText] = useState(original);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftId = useId();
  const reasonId = useId();

  async function answer(verdict: ReviewVerdict, said?: string): Promise<void> {
    if (verdict === "edit" && (said ?? "").trim() === "") {
      setError("Write what to send instead of the draft.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onAnswer(review.key, verdict, said);
    } catch (caught) {
      setError(actionErrorText(caught, "The answer did not go through."));
    } finally {
      setSending(false);
    }
  }

  return (
    <section data-review aria-label={`Review, ${title}`} className="flex flex-col gap-3 rounded-lg border border-wait bg-wait-soft p-4">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <p className="text-meta text-muted">The run waits for your answer. It holds no model and no slot.</p>
      </header>
      {ask === null ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={draftId} className="text-meta text-muted">
            Draft
          </label>
          <Textarea id={draftId} value={text} rows={Math.min(14, Math.max(4, text.split("\n").length + 1))} onChange={(event) => setText(event.target.value)} className="bg-surface" />
        </div>
      ) : (
        <ToolAskBody tool={ask.tool} args={ask.args} source={ask.source} />
      )}
      {rejecting ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className="text-meta text-muted">
            Why not? The run reads this.
          </label>
          <Textarea id={reasonId} value={reason} rows={2} onChange={(event) => setReason(event.target.value)} className="bg-surface" />
        </div>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {rejecting ? (
          <>
            <Button kind="danger" disabled={sending} onClick={() => void answer("reject", reason.trim() === "" ? undefined : reason.trim())}>
              Send rejection
            </Button>
            <Button kind="ghost" disabled={sending} onClick={() => setRejecting(false)}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button kind="primary" disabled={sending} onClick={() => void answer("approve")}>
              Approve
            </Button>
            {ask === null ? (
              <Button disabled={sending} onClick={() => void answer("edit", text)}>
                Edit and approve
              </Button>
            ) : null}
            <Button kind="danger" disabled={sending} onClick={() => setRejecting(true)}>
              Reject…
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
