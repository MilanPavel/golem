import type { HelperCardModel } from "@golem/view";
import { Button } from "../../ui/button.tsx";
import { Kbd } from "../../ui/kbd.tsx";
import { Seal } from "./approval-bar.tsx";

const INK_KBD = "border-bg/40 bg-transparent text-bg";

/**
 * The question "Use helpers: Ask me first" asks before a `delegate` call starts: the helpers it would start, what each
 * is asked, and two answers. "Run" is the main one (Enter). With an estimate (a large batch on a paid model) the card says what it costs, "Run" reads "Start", and "Use a cheaper model" shows when there is one. "Do it in the chat" tells the model to do the work itself.
 * There is no "for this session" choice: the setting is the place to change how often this is asked.
 */
export function HelperBatchCard({
  model,
  sending = false,
  error = null,
  id,
  onAnswer,
}: {
  model: HelperCardModel;
  sending?: boolean;
  error?: string | null;
  id?: string;
  /** `run` and `cheaper` are what go to `helpers.respond`. */
  onAnswer: (run: boolean, cheaper: boolean) => void;
}) {
  return (
    <section id={id} role="group" aria-label="Start helpers" data-helper-batch="" className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-soft">
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2">
        <Seal />
        <div className="min-w-0">
          <p className="text-sm leading-snug font-semibold wrap-anywhere" data-helper-head="">
            {model.head}
          </p>
          {model.line === null ? (
            <p className="mt-0.5 text-meta leading-snug text-faint wrap-anywhere">Use helpers is set to "Ask me first".</p>
          ) : (
            <p className="mt-0.5 text-sm leading-snug text-muted wrap-anywhere" data-helper-estimate="">
              {model.line}
            </p>
          )}
        </div>
      </div>
      {model.jobs.length === 0 ? null : (
        <ul className="m-0 flex max-h-48 list-none flex-col gap-1.5 overflow-auto px-3 pb-2 text-sm">
          {model.jobs.map((job, index) => (
            <li key={index} className="flex min-w-0 gap-2" data-helper-job="">
              <span className="flex-none text-ink">{job.label === null ? job.agent : `${job.agent} · ${job.label}`}</span>
              <span className="line-clamp-2 min-w-0 text-muted wrap-anywhere">{job.brief}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        {model.actions.map((action) => (
          <Button
            key={action.id}
            kind={action.primary ? "ink" : "secondary"}
            disabled={sending}
            aria-keyshortcuts={action.key === "enter" ? "Enter" : undefined}
            data-helper-answer={action.id}
            title={action.cheaper && model.estimate?.cheaperModel ? `Runs on ${model.estimate.cheaperModel}` : undefined}
            onClick={() => {
              onAnswer(action.run, action.cheaper);
            }}
          >
            {action.label}
            {action.key === "enter" ? <Kbd className={INK_KBD}>↵</Kbd> : null}
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
