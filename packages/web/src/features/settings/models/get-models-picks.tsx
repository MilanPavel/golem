import { categoryName, type Category } from "@golem/view";
import type { ListedModel, ModelListResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { Code } from "../../../ui/code.tsx";
import { diskText, shortName } from "../../models/model-text.ts";
import { MemoryBar, PullAction } from "./get-models-action.tsx";
import { Chip } from "./get-models-split.tsx";

/** The chips of the list: All, then the categories a person looks by. */
const CHIPS: readonly (Category | null)[] = [null, "general", "coding", "reasoning", "vision", "fast"];

/** The models of the picks tab: Ollama's, on this Mac or in golem's list, in the order the daemon gave. */
export function picksOf(listing: ModelListResult | null): ListedModel[] {
  return (listing?.models ?? []).filter((model) => model.provider === "ollama" && (model.source === "installed" || model.source === "catalog"));
}

/** Every word of the search has to be in the label, the ref or a category. */
export function matchesSearch(model: ListedModel, search: string): boolean {
  const words = search.toLowerCase().split(/[\s/]+/).filter((word) => word !== "");
  const text = [model.label, model.ref, ...(model.categories ?? []).map(categoryName)].join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

export type PicksFilter = { category: Category | null; hideTooBig: boolean };

/** The picks the search and the filters leave. */
export function visiblePicks(listing: ModelListResult | null, search: string, filter: PicksFilter): ListedModel[] {
  return picksOf(listing).filter(
    (model) =>
      matchesSearch(model, search) &&
      (filter.category === null || (model.categories ?? []).includes(filter.category)) &&
      !(filter.hideTooBig && model.fit === "too_big"),
  );
}

function FitMeter({ model, ramGb }: { model: ListedModel; ramGb: number | null }) {
  return <MemoryBar fit={model.fit} sizeGb={model.size_gb} ramGb={ramGb} />;
}

type ActionProps = {
  model: ListedModel;
  pulls: PullsSnapshot;
  pull: (ref: string) => Promise<boolean>;
  onStop: (ref: string) => void;
  primary?: boolean;
};

/** Download, then a bar with a percent and a cancel, then Installed. */
function Action({ model, ...rest }: ActionProps) {
  const target = {
    ref: model.ref,
    name: shortName(model.ref),
    installed: model.source === "installed" && model.status === "ready",
    pulling: model.status === "pulling",
    progress: model.progress,
    tooBig: model.fit === "too_big",
  };
  return <PullAction target={target} {...rest} />;
}

function sizeText(model: ListedModel): string {
  return model.size_gb === null || model.size_gb === undefined ? "" : `${model.size_gb} GB`;
}

/** The card for the model golem recommends for this Mac. */
function Recommended({ model, listing, ...action }: ActionProps & { listing: ModelListResult }) {
  const ram = listing.ram_gb ?? null;
  const good = (model.categories ?? []).map((category) => categoryName(category).toLowerCase());
  const why = [
    sizeText(model) === "" ? "" : `${sizeText(model)}.`,
    ram === null ? "The pick for this Mac." : `The pick for this Mac's ${ram} GB of memory.`,
    good.length === 0 ? "" : `Good for ${good.length > 1 ? `${good.slice(0, -1).join(", ")} and ${good.at(-1) ?? ""}` : good.join("")}.`,
  ]
    .filter((part) => part !== "")
    .join(" ");
  const disk = diskText(model, listing);
  return (
    <div role="group" aria-label="Recommended for this Mac" className="mb-1.5 flex shrink-0 items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-clay-ink">Recommended for this Mac</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 font-semibold">
          {model.label}
          <Code tone="muted">{shortName(model.ref)}</Code>
        </p>
        <p className="text-sm text-muted">{why}</p>
        {disk === null ? null : <p className="text-sm text-wait">{disk}</p>}
      </div>
      <Action model={model} {...action} primary />
    </div>
  );
}

const COLUMNS = "flex flex-wrap items-center gap-x-3.5 gap-y-1 md:flex-nowrap";

export type PicksProps = {
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  search: string;
  pull: (ref: string) => Promise<boolean>;
  onStop: (ref: string) => void;
  failure: string | null;
  /** The two other places, for an empty result. */
  places: readonly { id: string; label: string }[];
  onPlace: (id: string) => void;
  filter: PicksFilter;
  onFilter: (filter: PicksFilter) => void;
};

/** Picked for this Mac: golem's list, sized for this Mac, one line a model. */
export function PicksTab({ listing, pulls, search, pull, onStop, failure, places, onPlace, filter, onFilter }: PicksProps) {
  const { category, hideTooBig } = filter;
  const all = picksOf(listing);
  const rows = visiblePicks(listing, search, { category, hideTooBig });
  const recommended = all.find((model) => model.recommended === true);
  const filtering = search.trim() !== "" || category !== null;
  const ramGb = listing?.ram_gb ?? null;
  const installed = (model: ListedModel) => model.source === "installed" && model.status === "ready";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="group" aria-label="Filter the list" className="flex shrink-0 flex-wrap items-center gap-2 pb-2.5 pt-3">
        {CHIPS.map((chip) => (
          <Chip
            key={chip ?? "all"}
            pressed={chip === category}
            onClick={() => {
              onFilter({ ...filter, category: chip });
            }}
          >
            {chip === null ? "All" : categoryName(chip)}
          </Chip>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          role="switch"
          aria-checked={hideTooBig}
          onClick={() => {
            onFilter({ ...filter, hideTooBig: !hideTooBig });
          }}
          className="flex items-center gap-2 text-meta text-muted outline-offset-2 outline-clay focus-visible:outline-2"
        >
          <span aria-hidden="true" className={cn("flex h-4 w-7 items-center rounded-full p-0.5", hideTooBig ? "justify-end bg-clay" : "justify-start bg-line-strong")}>
            <span className="size-3 rounded-full bg-surface" />
          </span>
          Hide the ones too big
        </button>
      </div>
      {failure === null ? null : (
        <p role="alert" className="shrink-0 pb-2 text-sm text-deny">
          {failure}
        </p>
      )}
      {recommended === undefined || filtering || installed(recommended) || listing === null ? null : (
        <Recommended model={recommended} listing={listing} pulls={pulls} pull={pull} onStop={onStop} />
      )}
      {rows.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-10 text-center">
          <h4 className="text-base font-semibold">{all.length === 0 ? "golem has no list for this Mac yet" : "Not in golem's list"}</h4>
          <p className="mx-auto mb-3 mt-1 max-w-prose text-sm text-muted">
            {all.length === 0
              ? "You can still get a model by its name or from Hugging Face."
              : "golem keeps a short list of models it has tried. Anything else you can get by its name or from Hugging Face."}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {places.map((place) => (
              <Button
                key={place.id}
                size="sm"
                onClick={() => {
                  onPlace(place.id);
                }}
              >
                {place.label}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div aria-hidden="true" className={cn(COLUMNS, "shrink-0 max-md:hidden px-2.5 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wider text-faint")}>
            <span className="min-w-0 flex-1">Model</span>
            <span className="hidden w-36 shrink-0 lg:block">Good for</span>
            <span className="w-16 shrink-0 text-right">Size</span>
            <span className="w-36 shrink-0">On this Mac</span>
            <span className="w-36 shrink-0" />
          </div>
          <ul aria-label="Models for this Mac" className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((model) => {
              const failed = pulls.failed.get(model.ref);
              const categories = model.categories ?? [];
              return (
                <li key={model.ref} className="border-t border-line px-2.5 py-1.5 hover:bg-surface/80">
                  <div className={cn(COLUMNS, "min-h-11 lg:min-h-8")}>
                    <span className="flex min-w-0 basis-full items-baseline gap-2 overflow-hidden whitespace-nowrap md:flex-1 md:basis-0">
                      <b className="truncate text-sm font-semibold">{model.label}</b>
                      <Code tone="muted" className="truncate">{shortName(model.ref)}</Code>
                      {model.recommended === true ? <span className="rounded-sm bg-allow-soft px-1.5 py-0.5 text-xs font-semibold tracking-wide text-allow">RECOMMENDED</span> : null}
                    </span>
                    <span className="hidden w-36 shrink-0 flex-wrap gap-1 lg:flex">
                      {categories.map((category) => (
                        <span key={category} className="rounded-sm bg-sunken px-1.5 py-px text-xs text-muted">
                          {categoryName(category)}
                        </span>
                      ))}
                    </span>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-soft">{sizeText(model)}</span>
                    <span className="w-36 shrink-0">
                      <FitMeter model={model} ramGb={ramGb} />
                    </span>
                    <span className="w-36 shrink-0">
                      <Action model={model} pulls={pulls} pull={pull} onStop={onStop} />
                    </span>
                  </div>
                  {failed === undefined || failed === "cancelled" ? null : <p className="pb-1 text-meta text-deny">{`Download failed: ${failed}`}</p>}
                  {listing === null || installed(model) ? null : (
                    <>{diskText(model, listing) === null ? null : <p className="pb-1 text-meta text-wait">{diskText(model, listing)}</p>}</>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
