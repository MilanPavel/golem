import {
  CONSENT_LABELS,
  CONSENT_TITLE,
  consentAnswers,
  consentCapsLine,
  consentLine,
  type ConsentChoice,
  type PendingConsent,
} from "@golem/view";
import { Button } from "../../ui/button.tsx";
import { Seal } from "../approval/approval-bar.tsx";

/**
 * The paid step-up question, docked above the composer in the style of the approval card: what golem
 * asks, why, the model and its estimate, the caps when they are set, and the answers.
 */
export function ConsentBar({
  consent,
  sending = false,
  error = null,
  onAnswer,
}: {
  consent: PendingConsent;
  sending?: boolean;
  error?: string | null;
  onAnswer: (answer: ConsentChoice) => void;
}) {
  const caps = consentCapsLine(consent);
  const answers = consentAnswers(consent);
  return (
    <section role="group" aria-label="Paid model" data-consent-bar="" className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-soft">
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2">
        <Seal />
        <div className="min-w-0">
          <p className="text-sm leading-snug font-semibold wrap-anywhere">{CONSENT_TITLE}</p>
          <p className="mt-0.5 text-sm leading-snug text-muted wrap-anywhere">{consent.why}</p>
          <p className="mt-1 font-mono text-xs leading-snug wrap-anywhere" data-consent-line="">
            {consentLine(consent)}
          </p>
          {caps === "" ? null : <p className="mt-0.5 font-mono text-xs leading-snug text-faint wrap-anywhere">{caps}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        {answers.map((answer, index) => (
          <Button
            key={answer}
            kind={index === 0 ? "ink" : "secondary"}
            disabled={sending}
            data-answer={answer}
            onClick={() => {
              onAnswer(answer);
            }}
          >
            {CONSENT_LABELS[answer]}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="px-3 pb-3 text-sm text-deny">
          {error}
        </p>
      ) : null}
    </section>
  );
}
