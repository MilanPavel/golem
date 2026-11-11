import type { TraceNode } from "../../store/trace.ts";
import type { Bar, Tick } from "./waterfall.ts";

/** The look of a bar: clay for a model call, a neutral line for a tool, red for a failure. */
function barClass(span: TraceNode): string {
  if (span.kind === "run") return "bg-muted";
  if (span.status === "failed" || span.status === "denied") return "bg-deny";
  return span.kind === "model" ? "bg-clay" : "bg-line-strong";
}

/**
 * One span on its run's time line. The position is a share of the run, which only a style can
 * say; every colour is a token.
 */
export function WaterfallBar({ span, bar, ticks, compact = false }: { span: TraceNode; bar: Bar; ticks?: Tick[]; compact?: boolean }) {
  const thin = span.kind === "run";
  const scale = thin && ticks !== undefined && ticks.length > 0 ? ticks : null;
  return (
    <span aria-hidden="true" className={`relative block h-4 min-w-0 ${compact ? "w-12 shrink-0 @max-sm:hidden" : "flex-1"}`}>
      {bar.wait === null ? null : (
        <span
          data-part="wait"
          className="absolute top-1/2 block h-2 -translate-y-1/2 rounded-xs"
          style={{
            left: `${bar.wait.left}%`,
            width: `${bar.wait.width}%`,
            backgroundImage:
              "repeating-linear-gradient(135deg, var(--color-wait) 0 2px, var(--color-wait-soft) 2px 4px)",
          }}
        />
      )}
      <span
        data-part="bar"
        className={`absolute block min-w-0.5 rounded-xs ${
          thin ? (scale === null ? "top-1/2 h-px -translate-y-1/2" : "bottom-0 h-px") : "top-1/2 h-2.5 -translate-y-1/2"
        } ${barClass(span)}`}
        style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
      />
      {scale?.map((tick) => (
        <span key={tick.left} data-part="tick">
          <span className="absolute bottom-0 block h-1.5 w-px bg-line-strong" style={{ left: `${tick.left}%` }} />
          {compact ? null : <span
            data-part="tick-label"
            className="absolute top-0 -translate-x-1/2 font-mono text-xs leading-none text-faint max-wide:hidden"
            style={{ left: `${tick.left}%` }}
          >
            {tick.label}
          </span>}
        </span>
      ))}
    </span>
  );
}
