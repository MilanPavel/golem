import { categoryLabel, edgeLabels, emptyText, emptyTone, keyText, mostOftenText, numberText, percentText, uniqueText, type ViewCell } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import type { DataColumnProfile } from "../../store/data.ts";

/** The width of a histogram in its own units; it is drawn as wide as its column, up to 15 rem. */
const WIDTH = 208;
const HEIGHT = 30;

/** The bars of a number or a date: how many rows fall in each of 24 equal slices from the lowest to the highest value. */
export function Histogram({ column }: { column: DataColumnProfile }) {
  const bins = column.bins ?? [];
  const peak = Math.max(1, ...bins);
  const slice = WIDTH / Math.max(1, bins.length);
  const isDate = column.shape === "date";
  const low = typeof column.min === "number" ? column.min : null;
  const high = typeof column.max === "number" ? column.max : null;
  const [from, to] = edgeLabels(column.min, column.max, isDate);
  const label = `${column.name}: ${from} to ${to}`;
  return (
    <div className="flex w-full max-w-60 flex-col gap-0.5">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label} className="block h-8 w-full">
        {bins.map((count, at) => {
          const tall = Math.max(1, (count / peak) * HEIGHT);
          const edge = low !== null && high !== null ? `${numberText(low + (at * (high - low)) / bins.length, 1)} … ${numberText(low + ((at + 1) * (high - low)) / bins.length, 1)}: ` : "";
          return (
            <rect key={at} x={at * slice + 0.5} y={HEIGHT - tall} width={slice - 1.5} height={tall} rx={1} className="fill-clay/70">
              <title>{`${edge}${numberText(count)} rows`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between gap-2 text-xs text-faint">
        <Code tone="inherit" className="truncate text-xs">
          {from}
        </Code>
        <Code tone="inherit" className="truncate text-xs">
          {to}
        </Code>
      </div>
    </div>
  );
}

/** The most frequent values of a category as bars. A click on a bar asks for the rows with that value. */
export function CategoryBars({ column, present, onPick }: { column: DataColumnProfile; present: number; onPick: (column: string, value: ViewCell) => void }) {
  const top = column.top ?? [];
  const values = top.map((each) => each.value);
  const more = column.more_values ?? 0;
  return (
    <div className="flex w-full max-w-60 flex-col gap-0.5">
      {top.map((each, at) => {
        const text = categoryLabel(values, each.value);
        const share = present > 0 ? (each.count / present) * 100 : 0;
        return (
          <button
            key={at}
            type="button"
            title={`Show these ${numberText(each.count)} rows`}
            aria-label={`${column.name} ${text}, ${percentText(each.count, present)}: show these ${numberText(each.count)} rows`}
            onClick={() => onPick(column.name, each.value)}
            className="group flex items-center gap-1.5 rounded-sm text-left outline-offset-2 outline-clay focus-visible:outline-2"
          >
            <span className="relative h-3 flex-1 rounded-sm bg-sunken">
              <span className="absolute inset-y-0 left-0 rounded-sm bg-clay/70 group-hover:bg-clay" style={{ width: `${share}%` }} />
            </span>
            <Code tone="muted" className="w-26 truncate text-xs">
              {text}
            </Code>
            <Code tone="inherit" className="w-8 text-right text-xs text-faint">
              {percentText(each.count, present)}
            </Code>
          </button>
        );
      })}
      {more > 0 ? (
        <Code tone="inherit" className="pl-0.5 text-xs text-faint">
          + {numberText(more)} more · {percentText(column.more_rows ?? 0, present)}
        </Code>
      ) : null}
    </div>
  );
}

/** A text column: how many values are different, and the one that repeats most. */
export function TextBar({ column }: { column: DataColumnProfile }) {
  const ratio = column.unique_ratio ?? 0;
  const common = column.most_common ?? null;
  return (
    <div className="flex w-full max-w-60 flex-col gap-1">
      <div className="flex h-3 overflow-hidden rounded-sm bg-sunken">
        <span className="bg-clay/70" style={{ width: `${ratio * 100}%` }} />
      </div>
      <Code tone="muted" className="text-xs">
        {uniqueText(ratio, column.avg_length)}
      </Code>
      {common === null ? null : (
        <Code tone="inherit" className="truncate text-xs text-faint" title={String(common.value)}>
          {mostOftenText(common.value, common.count)}
        </Code>
      )}
    </div>
  );
}

/** A column whose every value is different and none is missing. */
export function KeyBar({ column }: { column: DataColumnProfile }) {
  return (
    <div className="flex w-full max-w-60 flex-col gap-1">
      <div className="h-3 rounded-sm bg-clay/70" />
      <Code tone="muted" className="text-xs">
        {keyText(column.min, column.max)}
      </Code>
    </div>
  );
}

/** How many rows have no value: amber when some do, red from half. */
export function EmptyMeter({ empty }: { empty: number }) {
  const tone = emptyTone(empty);
  const pct = Math.round(empty * 100);
  return (
    <div className="flex items-center gap-1.5" title={tone === "none" ? "Every row has a value" : `${pct}% of rows have no value`}>
      <span className="relative h-1.5 w-12 rounded-full bg-sunken">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", tone === "most" ? "bg-deny" : tone === "some" ? "bg-wait" : "")} style={{ width: `${tone === "some" ? Math.max(pct, 6) : pct}%` }} />
      </span>
      <Code tone="inherit" className={cn("whitespace-nowrap text-xs", tone === "none" ? "text-faint" : "text-muted")}>
        {emptyText(empty)}
      </Code>
    </div>
  );
}

/** The chart that fits a column's shape. */
export function ShapeChart({ column, present, onPick }: { column: DataColumnProfile; present: number; onPick: (column: string, value: ViewCell) => void }) {
  if (column.shape === "key") return <KeyBar column={column} />;
  if ((column.shape === "number" || column.shape === "date") && (column.bins ?? []).length > 0) return <Histogram column={column} />;
  if (column.shape === "category") return <CategoryBars column={column} present={present} onPick={onPick} />;
  return <TextBar column={column} />;
}
