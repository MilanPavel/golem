import { reasonTiles, rulesFoot, type DelegateNumbers, type ReasonBar, type ReasonTile, type RulesMeasurement, type TilePart } from "@golem/view";
import type { ReactNode } from "react";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { GolemScene, type GolemSceneKind } from "../../ui/golem-scene.tsx";

const SCENE: Record<ReasonTile["key"], GolemSceneKind> = { fit: "pages", parallel: "team", model: "pair" };

/** The colour of a segment: the first is clay, a second is a paler clay, and the cheaper model's bar is green. */
function segmentClass(tile: ReasonTile["key"], bar: ReasonBar, at: number): string {
  if (tile === "model" && bar.label === "cheaper model") return "bg-allow";
  return at === 0 ? "bg-clay" : "bg-clay/60";
}

/** The picture of the window: thin labelled bars. Decorative, the When line says the same in words. */
function WindowBars({ tile }: { tile: ReasonTile }) {
  return (
    <div aria-hidden="true" data-window="" className="flex flex-col gap-1.5 self-center text-xs text-faint">
      {tile.bars.map((bar) => (
        <div key={bar.label} style={{ gridTemplateColumns: "6.25rem minmax(0, 1fr)" }} className="grid items-center gap-2">
          <span className="whitespace-nowrap">{bar.label}</span>
          <div className="flex h-2.5 rounded-sm border border-line-strong bg-sunken">
            {bar.parts.map((part, at) => (
              <i key={at} data-part="" style={{ width: `${part * 100}%`, boxShadow: at === 0 ? undefined : "-1px 0 0 var(--color-bg)" }} className={cn("block h-full", segmentClass(tile.key, bar, at))} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A number as a chip, with the small "default" note after it when it was changed. Chip and note never split. */
function Chip({ part }: { part: TilePart }) {
  const changed = part.changed === true;
  return (
    <span className="whitespace-nowrap">
      <span data-number="" data-changed={changed ? "" : undefined} className={cn("rounded-md border px-1.5 py-px text-xs font-semibold tabular-nums", changed ? "border-clay/40 bg-clay-soft text-clay-ink" : "border-line bg-sunken text-ink")}>
        {part.text}
      </span>
      {part.tag === undefined ? null : (
        <>
          {" "}
          <span data-default-tag="" className="text-xs font-normal text-faint">
            {part.tag}
          </span>
        </>
      )}
    </span>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p style={{ gridTemplateColumns: "2.5rem minmax(0, 1fr)" }} className="grid gap-x-1.5 text-meta leading-7 text-ink-soft">
      <span className="text-xs font-semibold leading-7 uppercase tracking-wider text-faint">{label}</span>
      <span>{children}</span>
    </p>
  );
}

function ReasonBlock({ tile }: { tile: ReasonTile }) {
  return (
    <div data-reason={tile.key} className="grid gap-y-2 rounded-md border border-line bg-bg p-3.5 @4xl:row-span-6 @4xl:grid-rows-subgrid">
      <GolemScene kind={SCENE[tile.key]} />
      <h4 className="self-start text-sm font-semibold leading-tight text-ink">{tile.title}</h4>
      <Line label="When">
        {tile.when.map((part, index) => (part.number === true ? <Chip key={index} part={part} /> : part.text))}
      </Line>
      <WindowBars tile={tile} />
      <Line label="Then">{tile.then}</Line>
      <small className="self-end text-xs text-faint">{tile.note}</small>
    </div>
  );
}

/**
 * The three reasons "When needed" lists, each a block with a picture, a When line with the numbers as chips, a picture
 * of the window and a Then line; and the line that says where the numbers come from. Dimmed, not hidden, when helpers are never used.
 */
export function ReasonBlocks({ delegate, measurement = null, dimmed, onMeasure }: { delegate: DelegateNumbers; measurement?: RulesMeasurement | null; dimmed: boolean; onMeasure: () => void }) {
  const foot = rulesFoot(delegate, measurement);
  return (
    <div data-reasons="" data-dimmed={dimmed ? "" : undefined} className="flex flex-col gap-3">
      <p className="text-xs text-faint">The context window is what the model can hold at once. These numbers come from Measure.</p>
      <div className={cn("grid gap-3 @4xl:grid-cols-3 @4xl:gap-y-0", dimmed && "opacity-50")}>
        {reasonTiles(delegate).map((tile) => (
          <ReasonBlock key={tile.key} tile={tile} />
        ))}
      </div>
      {dimmed ? (
        <p className="text-meta text-muted" data-reasons-off="">
          Not used while helpers are off.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-xs text-muted" data-reasons-foot="">
        <span>
          <span className="font-medium text-faint">{foot.tag}</span> {foot.text}
        </span>
        <Button size="sm" className="ml-auto" onClick={onMeasure}>
          {foot.kind === "measured" ? "Measure again" : "Measure on this Mac"}
        </Button>
      </div>
    </div>
  );
}
