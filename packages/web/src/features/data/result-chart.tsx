import { chartCutNote, formatCell, type ChartKind, type ChartPoint } from "@golem/view";

const LABEL_WIDTH = 150;
const BAR_AREA = 400;
const ROW = 24;

function short(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function BarChart({ points, label, value }: { points: readonly ChartPoint[]; label: string; value: string }) {
  const low = Math.min(0, ...points.map((point) => point.value));
  const high = Math.max(0, ...points.map((point) => point.value));
  const span = high - low === 0 ? 1 : high - low;
  const zero = LABEL_WIDTH + ((0 - low) / span) * BAR_AREA;
  return (
    <svg viewBox={`0 0 640 ${points.length * ROW + 8}`} role="img" aria-label={`Bar chart of ${value} by ${label}, ${points.length} bars`} className="w-full text-code">
      {points.map((point, at) => {
        const x = LABEL_WIDTH + ((Math.min(point.value, 0) - low) / span) * BAR_AREA;
        const width = (Math.abs(point.value) / span) * BAR_AREA;
        const text = formatCell(point.value).text;
        return (
          <g key={at}>
            <title>{`${point.label}: ${text}`}</title>
            <text x={LABEL_WIDTH - 8} y={at * ROW + 18} textAnchor="end" className="fill-ink">
              {short(point.label, 20)}
            </text>
            <rect x={x} y={at * ROW + 6} width={Math.max(width, 1)} height={16} rx={2} className="fill-clay" />
            <text x={(point.value < 0 ? x : x + width) + (point.value < 0 ? -6 : 6)} y={at * ROW + 18} textAnchor={point.value < 0 ? "end" : "start"} className="fill-muted">
              {text}
            </text>
          </g>
        );
      })}
      <line x1={zero} x2={zero} y1={2} y2={points.length * ROW + 6} className="stroke-line-strong" />
    </svg>
  );
}

const LEFT = 70;
const RIGHT = 620;
const TOP = 16;
const BOTTOM = 164;

function LineChart({ points, label, value }: { points: readonly ChartPoint[]; label: string; value: string }) {
  const low = Math.min(...points.map((point) => point.value));
  const high = Math.max(...points.map((point) => point.value));
  const span = high - low === 0 ? 1 : high - low;
  const at = (index: number): { x: number; y: number } => {
    const point = points[index];
    return { x: points.length === 1 ? (LEFT + RIGHT) / 2 : LEFT + (index / (points.length - 1)) * (RIGHT - LEFT), y: BOTTOM - (((point?.value ?? low) - low) / span) * (BOTTOM - TOP) };
  };
  const path = points.map((_, index) => `${at(index).x.toFixed(1)},${at(index).y.toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <svg viewBox="0 0 640 200" role="img" aria-label={`Line chart of ${value} by ${label}, ${points.length} points`} className="w-full text-code">
      <line x1={LEFT} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} className="stroke-line-strong" />
      <text x={LEFT - 8} y={TOP + 4} textAnchor="end" className="fill-muted">
        {formatCell(high).text}
      </text>
      <text x={LEFT - 8} y={BOTTOM + 4} textAnchor="end" className="fill-muted">
        {formatCell(low).text}
      </text>
      <polyline points={path} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-clay" />
      {points.length <= 60
        ? points.map((point, index) => (
            <circle key={index} cx={at(index).x} cy={at(index).y} r={3} className="fill-clay">
              <title>{`${point.label}: ${formatCell(point.value).text}`}</title>
            </circle>
          ))
        : null}
      <text x={LEFT} y={190} textAnchor="start" className="fill-muted">
        {first === undefined ? "" : short(first.label, 24)}
      </text>
      <text x={RIGHT} y={190} textAnchor="end" className="fill-muted">
        {last === undefined ? "" : short(last.label, 24)}
      </text>
    </svg>
  );
}

/** A result drawn as bars or a line, in plain SVG. `cut` is how many rows it left out. */
export function ResultChart({ kind, points, cut, label, value }: { kind: ChartKind; points: readonly ChartPoint[]; cut: number; label: string; value: string }) {
  if (points.length === 0) return <p className="text-sm text-muted">There are no numbers on this page to draw.</p>;
  return (
    <div data-chart={kind} className="flex flex-col gap-1">
      {kind === "bar" ? <BarChart points={points} label={label} value={value} /> : <LineChart points={points} label={label} value={value} />}
      {cut > 0 ? <p className="text-meta text-faint">{chartCutNote(kind, cut)}</p> : null}
    </div>
  );
}
