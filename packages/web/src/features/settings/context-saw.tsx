import { windowSize, type ContextChart } from "@golem/view";

const X0 = 30;
const X1 = 312;
const TOP = 12;
const BASE = 130;
const y = (pct: number): number => BASE - (pct / 100) * (BASE - TOP);

/** How full the window gets during a long chat, as a line that drops back at each clear. */
export function Saw({ chart, window, reserve }: { chart: ContextChart; window: number; reserve: number }) {
  const px = (x: number): number => X0 + x * (X1 - X0);
  const line = chart.line.map((point) => `${px(point.x).toFixed(1)},${y(point.pct).toFixed(1)}`).join(" ");
  const last = chart.line[chart.line.length - 1];
  const text = "fill-faint text-axis";
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="How full the window gets during a long chat" className="block h-auto w-full rounded-md border border-line bg-bg">
      <rect className="fill-line" x={X0} y={TOP} width={X1 - X0} height={y(100 - chart.reply) - TOP} opacity=".7" />
      <polygon className="fill-clay-soft" points={`${X0},${BASE} ${line} ${px(last?.x ?? 1).toFixed(1)},${BASE}`} />
      <polyline className="fill-none stroke-clay" strokeWidth="2" strokeLinejoin="round" points={line} />
      <line className="stroke-wait" strokeWidth="1.2" strokeDasharray="4 4" x1={X0} x2={X1} y1={y(chart.clearAt)} y2={y(chart.clearAt)} />
      <line className="stroke-ctx-summary" strokeWidth="1.2" strokeDasharray="4 4" x1={X0} x2={X1} y1={y(chart.compactAt)} y2={y(chart.compactAt)} />
      <text className={text} x={X0 + 4} y={TOP + 9}>{`kept for the reply · ${windowSize(reserve)}`}</text>
      <text className="fill-wait text-axis" x={X0 + 4} y={y(chart.clearAt) - 3}>1 · clear results</text>
      <text className="fill-ctx-summary text-axis" x={X0 + 4} y={y(chart.compactAt) - 3}>2 · summarise</text>
      <text className={text} x="4" y={TOP + 4}>{windowSize(window)}</text>
      <text className={text} x="4" y={BASE}>0</text>
      <text className={text} x={X0} y={144}>the chat goes on →</text>
      {chart.marks.map((mark, index) =>
        mark.kind === "clear" ? (
          <circle key={index} cx={px(mark.x)} cy={y(mark.pct)} r="3" className="fill-wait" />
        ) : (
          <rect key={index} x={px(mark.x) - 3.5} y={y(mark.pct) - 3.5} width="7" height="7" className="fill-ctx-summary" />
        ),
      )}
    </svg>
  );
}
