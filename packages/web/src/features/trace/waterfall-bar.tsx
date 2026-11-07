import type { TraceNode } from "../../store/trace.ts";
import type { Bar } from "./waterfall.ts";

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
export function WaterfallBar({ span, bar }: { span: TraceNode; bar: Bar }) {
  const thin = span.kind === "run";
  return (
    <span aria-hidden="true" className="relative block h-4 min-w-0 flex-1">
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
        className={`absolute top-1/2 block min-w-0.5 -translate-y-1/2 rounded-xs ${thin ? "h-px" : "h-2.5"} ${barClass(span)}`}
        style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
      />
    </span>
  );
}
