import { CONTEXT_WORDS, contextRightNow, type ContextRightNowInput } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { CARD, Spans } from "./routing-parts.tsx";

/** The card on top of Settings › Context: what the window and the two steps are now, in one short text. */
export function ContextRightNow({ input }: { input: ContextRightNowInput }) {
  const [first, ...rest] = contextRightNow(input);
  return (
    <section aria-label={CONTEXT_WORDS.rightNow} className={cn(CARD, "grid grid-cols-1 gap-1 border-l-4 border-l-clay px-6 py-5 @route:cols-route-lead @route:gap-4")}>
      <div className="pt-1 text-meta font-medium text-clay-ink">{CONTEXT_WORDS.rightNow}</div>
      <div aria-live="polite" className="flex max-w-prose flex-col gap-2">
        <p className="font-prose text-lead text-ink-soft text-pretty">
          <Spans spans={first ?? []} />
        </p>
        {rest.map((spans, index) => (
          <p key={index} className="text-chat text-muted">
            <Spans spans={spans} />
          </p>
        ))}
      </div>
    </section>
  );
}
