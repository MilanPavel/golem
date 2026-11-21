import { inboxAnswerOptions, inboxHelperAskWords, type ApprovalAnswerOption, type InboxItem } from "@golem/view";
import { Button } from "../../ui/button.tsx";
import { Kbd } from "../../ui/kbd.tsx";
import { Headline } from "../inbox/headline.tsx";
import { Seal } from "./approval-bar.tsx";

const INK_KBD = "border-bg/40 bg-transparent text-bg";

/** The button kind of an answer: once is the main one, deny is red. */
export function answerKind(option: Pick<ApprovalAnswerOption, "id">): "ink" | "danger" | "secondary" {
  return option.id === "once" ? "ink" : option.id === "deny" ? "danger" : "secondary";
}

/**
 * The approval a helper asks, docked above the lead's composer. The helper is named on the first line. What the
 * question is about comes from the pending item (the tool, the subject, the rule, the line counts), so the card
 * needs no attach to the helper's session; "Open helper" shows the full call there. The answers are the scopes of
 * `inboxAnswerOptions`, and the keys are bound by the caller.
 */
export function HelperQuestion({
  item,
  sending = false,
  error = null,
  id,
  onAnswer,
  onOpen,
}: {
  item: InboxItem;
  sending?: boolean;
  error?: string | null;
  id?: string;
  onAnswer: (option: ApprovalAnswerOption) => void;
  onOpen: (item: InboxItem) => void;
}) {
  const helper = item.helper;
  if (helper === null) return null;
  const asks = inboxHelperAskWords(item.count);
  return (
    <section id={id} role="group" aria-label="Helper question" data-helper-question="" className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-soft">
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2">
        <Seal />
        <div className="min-w-0">
          <p className="text-sm leading-snug font-semibold wrap-anywhere" data-helper-name="">
            {helper.name} asks
          </p>
          <p className="mt-0.5 text-sm leading-snug wrap-anywhere">
            <Headline text={item.headline} />
          </p>
          <p className="mt-0.5 text-meta leading-snug text-faint wrap-anywhere">
            {[asks, item.source === null ? null : `asks: ${item.source}`].filter((part) => part !== null).join(" · ")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        {inboxAnswerOptions(item).map((option) => (
          <Button
            key={option.id}
            kind={answerKind(option)}
            disabled={sending}
            aria-keyshortcuts={option.shown}
            data-answer={option.id}
            onClick={() => {
              onAnswer(option);
            }}
          >
            {option.label}
            <Kbd className={option.id === "once" ? INK_KBD : undefined}>{option.shown}</Kbd>
          </Button>
        ))}
        <Button
          kind="ghost"
          onClick={() => {
            onOpen(item);
          }}
        >
          Open helper
        </Button>
      </div>
      {error ? (
        <p role="alert" className="px-3 pb-3 text-sm text-deny">
          {error}
        </p>
      ) : null}
    </section>
  );
}
