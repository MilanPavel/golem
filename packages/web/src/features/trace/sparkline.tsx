import { formatTokens } from "@golem/view";
import type { SparkMark } from "./format.ts";
import { sparkPoints } from "./sparkline.ts";

const WIDTH = 96;
const HEIGHT = 20;

function labelOf(values: readonly number[], marks: readonly SparkMark[]): string {
  const base =
    values.length <= 8
      ? `Input tokens per model call: ${values.map(formatTokens).join(", ")}`
      : `Input tokens per model call: ${values.length} calls, first ${formatTokens(values[0] ?? 0)}, last ${formatTokens(values[values.length - 1] ?? 0)}, highest ${formatTokens(Math.max(...values))}`;
  return marks.length === 0 ? base : `${base}. ${marks.map((mark) => `${mark.label} before call ${mark.index + 1}`).join(", ")}`;
}

/** How the input grew from one model call to the next, as a hand-drawn line. */
export function Sparkline({ values, marks = [] }: { values: readonly number[]; marks?: readonly SparkMark[] }) {
  if (values.length < 2) return null;
  const points = sparkPoints(values, WIDTH, HEIGHT);
  const [lastX = "0", lastY = "0"] = (points.split(" ").pop() ?? "").split(",");
  return (
    <svg role="img" aria-label={labelOf(values, marks)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-5 w-24 shrink-0 overflow-visible max-narrow:hidden">
      <polyline points={points} fill="none" className="stroke-clay" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {marks.map((mark) => {
        const x = points.split(" ")[mark.index]?.split(",")[0];
        if (x === undefined) return null;
        return (
          <g key={mark.index} data-mark={mark.label}>
            <title>{mark.label}</title>
            <line x1={x} x2={x} y1={0} y2={HEIGHT} className="stroke-muted" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      <circle cx={lastX} cy={lastY} r={2} className="fill-clay" />
    </svg>
  );
}
