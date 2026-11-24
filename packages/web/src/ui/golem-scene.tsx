import { CELLS } from "./pixel-golem.tsx";
import { cn } from "./cn.ts";

/** Which picture: a golem beside a tall stack of pages, three small golems, a big golem with a small one, or one resting. */
export type GolemSceneKind = "pages" | "team" | "pair" | "rest";

const WIDTH = 88;
const HEIGHT = 64;
const GROUND = 61;

/** One golem from the figure's cells, each cell `s` wide. Closed eyes are a thin bar. */
function Golem({ x, y, s, closed = false }: { x: number; y: number; s: number; closed?: boolean }) {
  return (
    <g>
      {CELLS.map((cell) =>
        cell.eye && closed ? (
          <rect key={`${cell.x}-${cell.y}`} x={x + cell.x * s} y={y + cell.y * s + s * 0.55} width={s} height={s * 0.25} className="fill-golem-eye" />
        ) : (
          <rect key={`${cell.x}-${cell.y}`} x={x + cell.x * s} y={y + cell.y * s} width={s} height={s} className={cell.eye ? "fill-golem-eye" : "fill-golem-body"} />
        ),
      )}
    </g>
  );
}

function Page({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={30} height={9} className="fill-surface stroke-line-strong" strokeWidth={1} />
      <rect x={x + 3} y={y + 3} width={21} height={1.6} className="fill-line-strong" />
    </g>
  );
}

const PAGES: ReadonlyArray<readonly [number, number]> = [
  [52, 52],
  [50, 44],
  [53, 36],
  [50, 28],
  [52, 20],
  [50, 12],
  [53, 4],
];

/**
 * A small picture made of the pixel golem, for a block that says what golem does. Decorative: the sentence beside it
 * carries the meaning. The colours come from the tokens, so it follows the theme.
 */
export function GolemScene({ kind, className }: { kind: GolemSceneKind; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} shapeRendering="crispEdges" className={cn("block h-16 w-22 shrink-0", className)}>
      <rect x={0} y={GROUND} width={WIDTH} height={2} className="fill-line-strong" />
      {kind === "pages" ? (
        <>
          {PAGES.map(([x, y]) => (
            <Page key={`${x}-${y}`} x={x} y={y} />
          ))}
          <Golem x={4} y={35.8} s={4.2} />
        </>
      ) : null}
      {kind === "team" ? [2, 32, 62].map((x) => <Golem key={x} x={x} y={44.2} s={2.8} />) : null}
      {kind === "pair" ? (
        <>
          <Golem x={4} y={31} s={5} />
          <Golem x={58} y={44.2} s={2.8} />
        </>
      ) : null}
      {kind === "rest" ? <Golem x={14} y={25} s={6} closed /> : null}
    </svg>
  );
}
