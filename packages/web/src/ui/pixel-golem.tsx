import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn.ts";
import { GOLEM_STATE_LABEL, type GolemState } from "./golem-state.ts";
import "./pixel-golem.css";

// The 9×6 figure from packages/tui/src/logo.ts. b is body, d is an eye.
const ART = [
  "...bbb...",
  "..bdbdb..",
  "bbbbbbbbb",
  "b.bbbbb.b",
  "b.bbbbb.b",
  "..bb.bb..",
] as const;

const WIDTH = ART[0].length;

const CELLS = ART.flatMap((row, y) =>
  [...row].flatMap((char, x) => (char === "b" || char === "d" ? [{ x, y, eye: char === "d" }] : [])),
);

// Cell size: 2, 4 and 8 px.
const figure = cva("pixel-golem shrink-0", {
  variants: { size: { sm: "w-4.5", md: "w-9", lg: "w-18" } },
  defaultVariants: { size: "md" },
});

export type PixelGolemProps = VariantProps<typeof figure> & {
  state: GolemState;
  showLabel?: boolean;
  className?: string;
};

export function PixelGolem({ state, size, showLabel = false, className }: PixelGolemProps) {
  const label = GOLEM_STATE_LABEL[state];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        role="img"
        aria-label={`golem · ${label}`}
        data-state={state}
        viewBox={`0 0 ${WIDTH} ${ART.length}`}
        shapeRendering="crispEdges"
        className={figure({ size })}
      >
        {CELLS.map(({ x, y, eye }) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} className={eye ? "eye" : "body"} />
        ))}
      </svg>
      {showLabel ? (
        <span aria-hidden="true" className="font-mono text-xs text-muted">
          {label}
        </span>
      ) : null}
    </span>
  );
}
