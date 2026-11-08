import { formatTokens } from "@golem/view";
import { sparkPoints } from "./sparkline.ts";

const WIDTH = 96;
const HEIGHT = 20;

function labelOf(values: readonly number[]): string {
  if (values.length <= 8) return `Input tokens per model call: ${values.map(formatTokens).join(", ")}`;
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  return `Input tokens per model call: ${values.length} calls, first ${formatTokens(first)}, last ${formatTokens(last)}, highest ${formatTokens(Math.max(...values))}`;
}

/** How the input grew from one model call to the next, as a hand-drawn line. */
export function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;
  const points = sparkPoints(values, WIDTH, HEIGHT);
  const [lastX = "0", lastY = "0"] = (points.split(" ").pop() ?? "").split(",");
  return (
    <svg role="img" aria-label={labelOf(values)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-5 w-24 shrink-0 overflow-visible max-narrow:hidden">
      <polyline points={points} fill="none" className="stroke-clay" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2} className="fill-clay" />
    </svg>
  );
}
