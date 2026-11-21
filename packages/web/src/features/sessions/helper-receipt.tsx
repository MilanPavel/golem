import type { HelperBanner, HelperReceipt } from "@golem/view";
import { sessionPath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { HEADER_ROW } from "../../ui/header-row.ts";
import { ContinueButton, ContinueError, type ContinueAction } from "./continue-as-chat.tsx";

const LABEL = "text-meta text-faint";

export type HelperBannerBarProps = {
  banner: HelperBanner;
  /** The lead's session id, for the Back to lead link. */
  leadId: string;
  onBack: () => void;
  /** Stops the helper. Null once it ended. */
  onStop: (() => void) | null;
  /** Continue as chat. Null while the helper runs and once it was trimmed: the button is not shown. */
  onContinue?: ContinueAction | null;
};

/**
 * The thin bar above a helper's own chat: whose helper it is, its agent type and model, a way back to
 * the lead, Stop while it runs, and Continue as chat once it ended. A line under it says the chat is
 * read-only, and a refusal of Continue as chat shows under that.
 */
export function HelperBannerBar({ banner, leadId, onBack, onStop, onContinue = null }: HelperBannerBarProps) {
  return (
    <section aria-label="Helper banner" className="flex flex-col">
      <div className={cn(HEADER_ROW, "flex-wrap gap-x-2 gap-y-1 px-4 text-sm")}>
        <span className="min-w-0 truncate">
          Helper of <strong className="font-medium">{banner.lead ?? "the chat"}</strong>
        </span>
        <span className="rounded-sm bg-clay-soft px-1.5 py-0.5 text-xs text-clay-ink">{banner.agent}</span>
        {banner.model === null ? null : <Code tone="muted">{banner.model}</Code>}
        <span className="ml-auto flex items-center gap-2">
          <a
            href={sessionPath(leadId)}
            className="text-clay-ink underline underline-offset-2"
            onClick={(event) => {
              event.preventDefault();
              onBack();
            }}
          >
            Back to lead
          </a>
          {onStop === null ? null : (
            <Button size="sm" kind="danger" onClick={onStop}>
              Stop
            </Button>
          )}
          {onContinue === null ? null : <ContinueButton action={onContinue} />}
        </span>
      </div>
      <p className="border-b border-line px-4 py-1.5 text-xs text-muted">Read-only: the lead talks to this helper.</p>
      {onContinue?.error == null ? null : (
        <div className="border-b border-line px-4 py-1.5">
          <ContinueError action={onContinue} />
        </div>
      )}
    </section>
  );
}

/**
 * What a trimmed helper keeps, in place of its steps: the brief, how it ended with the numbers, when the
 * steps were removed, and that the answer is in the lead's chat. With `lead`, that last line is a link to it.
 */
export function HelperReceiptCard({ receipt, lead, className }: { receipt: HelperReceipt; lead?: { id: string; onOpen: () => void }; className?: string }) {
  return (
    <section aria-label="Helper receipt" className={cn("flex flex-col gap-2 rounded-md border border-line bg-surface p-3 text-sm", className)}>
      <p className={LABEL}>receipt</p>
      {receipt.brief === null ? null : (
        <p className="text-pretty">
          <span className="text-muted">Brief: </span>
          {receipt.brief}
        </p>
      )}
      <p className="text-muted">{[receipt.outcome, ...receipt.facts].join(" · ")}</p>
      {receipt.removed === null ? null : <p className="text-muted">{receipt.removed}</p>}
      <p className="text-muted">
        {lead === undefined ? (
          receipt.answerNote
        ) : (
          <>
            The answer is in the{" "}
            <a
              href={sessionPath(lead.id)}
              className="text-clay-ink underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                lead.onOpen();
              }}
            >
              lead&apos;s chat
            </a>
            .
          </>
        )}
      </p>
    </section>
  );
}
