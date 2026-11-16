import { ROUTING_WORDS, routingSummary, type RoutingState } from "@golem/view";
import { CARD, Spans } from "./routing-parts.tsx";
import { cn } from "../../ui/cn.ts";

/** Part A: what golem does now, in one short text that rewrites itself on every change. */
export function RoutingRightNow({ state }: { state: RoutingState }) {
  const [first, ...rest] = routingSummary(state);
  return (
    <section aria-label={ROUTING_WORDS.rightNow} className={cn(CARD, "grid grid-cols-1 gap-1 border-l-4 border-l-clay px-6 py-5 @route:cols-route-lead @route:gap-4")}>
      <div className="pt-1 font-mono text-micro font-semibold uppercase tracking-widest text-clay-ink">{ROUTING_WORDS.rightNow}</div>
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
