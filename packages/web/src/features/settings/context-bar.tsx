import { CONTEXT_WORDS, windowSize, type WindowBar, type WindowZoneKind } from "@golem/view";
import { cn } from "../../ui/cn.ts";

const ZONE: Record<WindowZoneKind, string> = {
  work: "bg-allow-soft",
  clear: "bg-wait-soft",
  summarise: "bg-ctx-summary-soft",
  reply: "bg-hatch",
};

const WORDS: Record<WindowZoneKind, string> = {
  work: CONTEXT_WORDS.fill.zones.work,
  clear: CONTEXT_WORDS.fill.zones.clear,
  summarise: CONTEXT_WORDS.fill.zones.summarise,
  reply: CONTEXT_WORDS.fill.zones.reply,
};

/** A marker over the bar: a label on a line that runs down into the bar. The tone is the step's colour. */
function Mark({ at, label, tone }: { at: number; label: string; tone: "wait" | "summary" }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-y-0 w-0", tone === "wait" ? "text-wait" : "text-ctx-summary")} style={{ left: `${at}%` }}>
      <span className="absolute top-0 -translate-x-1/2 rounded-xs border border-current bg-surface px-1.5 py-1 font-mono text-micro font-semibold whitespace-nowrap text-ink">
        {label}
      </span>
      <span className="absolute -left-px top-6 bottom-0 border-l-2 border-current" />
    </div>
  );
}

/** The window as one bar: room to work, step 1, step 2 and the reply, with the two settings as markers. It is a picture; the controls under it carry the labels. */
export function WindowBarView({ bar, window, reserve, estimated = false }: { bar: WindowBar; window: number | null; reserve: number; estimated?: boolean }) {
  return (
    <div>
      <div className="relative pt-7 pb-1">
        <div aria-hidden="true" className="flex h-10 overflow-hidden rounded-sm border border-line-strong">
          {bar.zones.map((zone) => (
            <div
              key={zone.kind}
              className={cn("flex items-center overflow-hidden px-2.5 font-mono text-micro font-semibold whitespace-nowrap", zone.kind === "reply" ? "text-faint" : "text-ink-soft", ZONE[zone.kind])}
              style={{ width: `${zone.to - zone.from}%` }}
            >
              {window === null && zone.kind === "reply" ? `reply · ${windowSize(reserve)}` : WORDS[zone.kind]}
            </div>
          ))}
        </div>
        <Mark at={bar.marks.clear.at} label={bar.marks.clear.label} tone="wait" />
        <Mark at={bar.marks.summarise.at} label={bar.marks.summarise.label} tone="summary" />
      </div>
      <div aria-hidden="true" className="mt-1.5 flex justify-between font-mono text-micro text-faint">
        <span>0</span>
        <span>the chat grows →</span>
        <span>{window === null ? "the window" : `${estimated ? "≈ " : ""}${windowSize(window)}`}</span>
      </div>
    </div>
  );
}
