import { ROUTING_WORDS, situations, type Outcome, type Situation } from "@golem/view";
import { useEffect, useState } from "react";
import { cn } from "../../ui/cn.ts";
import type { Lit } from "./routing-path.tsx";
import { Spans } from "./routing-parts.tsx";

const STEP_MS = 300;

function reducedMotion(): boolean {
  return typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Lights the parts of an outcome one after the other, about 300 ms apart (at once when the person
 * prefers no motion). A new outcome, such as after a settings change, plays again from the start.
 */
export function usePlayback(outcome: Outcome | null): Lit {
  const parts = outcome?.parts ?? [];
  const key = JSON.stringify(parts);
  const [seen, setSeen] = useState<{ key: string; shown: number }>({ key: "", shown: 0 });
  const still = reducedMotion();
  useEffect(() => {
    if (still) return;
    const timers = JSON.parse(key).map((_: unknown, index: number) =>
      setTimeout(() => setSeen({ key, shown: index + 1 }), index * STEP_MS),
    ) as ReturnType<typeof setTimeout>[];
    return () => timers.forEach(clearTimeout);
  }, [key, still]);
  const shown = still ? parts.length : seen.key === key ? seen.shown : 0;
  return Object.fromEntries(parts.slice(0, shown).map(({ part, state }) => [part, state]));
}

const MARKS = {
  ok: { sign: "✓", look: "bg-allow-soft text-allow", name: "Stays free" },
  pays: { sign: "$", look: "bg-clay-soft text-clay-ink", name: "Costs money" },
  stops: { sign: "!", look: "bg-deny-soft text-deny", name: "Stops" },
} as const;

/** Part C, Try it: five situations, one pressed at a time, and where the turn goes. */
export function RoutingTry({
  window,
  pressed,
  outcome,
  onPress,
}: {
  window: string | null;
  pressed: Situation | null;
  outcome: Outcome | null;
  onPress: (situation: Situation | null) => void;
}) {
  const mark = outcome === null ? null : MARKS[outcome.mark];
  return (
    <div className="border-t border-dashed border-line-strong pt-4">
      <p className="mb-2 text-note text-muted">
        <b className="font-semibold text-ink">{ROUTING_WORDS.try.title}</b> {ROUTING_WORDS.try.line}
      </p>
      <div className="flex flex-wrap gap-2">
        {situations(window).map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={pressed === item.value}
            onClick={() => onPress(pressed === item.value ? null : item.value)}
            className="rounded-full border border-line-strong bg-surface px-3 py-1 text-note hover:border-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bg"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div aria-live="polite" className={cn("mt-3 flex min-h-11.5 items-start gap-2.5 text-sm", outcome === null ? "text-faint" : "text-ink-soft")}>
        {outcome === null || mark === null ? (
          ROUTING_WORDS.try.idle
        ) : (
          <>
            <span aria-hidden="true" className={cn("mt-px grid size-5.5 flex-none place-items-center rounded-full text-note font-bold", mark.look)}>
              {mark.sign}
            </span>
            <span>
              <span className="sr-only">{`${mark.name}. `}</span>
              <Spans spans={outcome.sentence} />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
