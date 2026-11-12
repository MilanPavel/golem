import {
  namesModel,
  providerMissing,
  type Category,
  type PickerGroup,
} from "@golem/view";
import { useState, type ReactNode, type Ref } from "react";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { SlidersIcon } from "../../ui/icons.tsx";
import {
  resolveActive,
  SearchList,
  type SearchListItem,
} from "../../ui/search-list.tsx";
import { ModelRow } from "./model-row.tsx";

/** One row of the list: the model, under the heading of its group. */
export type ModelListRow = SearchListItem & { model: ListedModel };

/** The rows of the groups, in display order. A model in more than one group is listed once, in the first. */
export function listRows(groups: readonly PickerGroup[]): ModelListRow[] {
  const seen = new Set<string>();
  return groups.flatMap((group) =>
    group.models.flatMap((model) => {
      if (seen.has(model.ref)) return [];
      seen.add(model.ref);
      return [{ id: model.ref, group: group.title, model }];
    }),
  );
}

/** What a row can say beyond the model itself. */
export type ModelListNote = {
  /** A tag after the name, such as `recommended`. */
  tag?: string;
  /** One line under the name. */
  reason?: string;
  /** How long the download takes, next to the size. */
  estimate?: string;
};

export type ModelListProps = {
  /** The listing the rows come from: it knows which provider is missing and which model is the default. */
  listing: ModelListResult | null;
  /** The groups to show, in order, after the search and the category filter. */
  groups: readonly PickerGroup[];
  /** A group before the others, with its own heading, such as `Fits this Mac · 16 GB memory`. Its models leave the other groups. */
  leading?: PickerGroup;
  /** Per model ref: a tag, a reason and a time estimate. */
  notes?: ReadonlyMap<string, ModelListNote>;
  /** Show only the first `keep` rows, then a button for the rest: `Show all N models`. */
  collapse?: { keep: number };
  /** The profile the session uses, to mark the current row. */
  profile: string | null;
  /** The category filter, so a pick for it can be named. */
  category: Category | null;
  pulls: PullsSnapshot;
  query: string;
  onQueryChange: (query: string) => void;
  /** The selected row. The first one when it is null or names a row that is not listed. */
  activeId: string | null;
  onActiveChange: (id: string) => void;
  /** Enter on the selected row, or a double click on one. */
  onActivate: (model: ListedModel) => void;
  /** Shown when no row is listed. */
  empty: ReactNode;
  /** Scrolls with the list, after it. */
  after?: ReactNode;
  /** The Tune shortcut of a row. A mouse shortcut: the keyboard has its own button. Without it no row has one. */
  onTune?: (model: ListedModel) => void;
  /** Which rows have a Tune shortcut. Every row does when it is left out. */
  tunable?: (model: ListedModel) => boolean;
  /** The Stop shortcut of a downloading row, a mouse shortcut like Tune. Without it no row has one. */
  onStop?: (model: ListedModel) => void;
  /** Below the list: the buttons for the selected row. */
  footer?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  listClassName?: string;
};

const ROW_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm border border-line-strong px-2 py-0.5 text-xs text-ink hover:bg-line";

/**
 * A search field over the models, grouped, with the facts of each row and the state of its download.
 * It has no dialog around it and reads no store, so the model dialog and `/welcome` can both use it.
 */
export function ModelList({
  listing,
  groups,
  leading,
  notes,
  collapse,
  profile,
  category,
  pulls,
  query,
  onQueryChange,
  activeId,
  onActiveChange,
  onActivate,
  empty,
  after,
  onTune,
  tunable,
  onStop,
  footer,
  inputRef,
  className,
  listClassName,
}: ModelListProps) {
  const [expanded, setExpanded] = useState(false);
  const all = listRows(leading === undefined ? groups : [leading, ...groups]);
  const folded =
    collapse !== undefined && !expanded && all.length > collapse.keep;
  const rows = folded ? all.slice(0, collapse.keep) : all;
  const active = resolveActive(rows, activeId);
  const defaultRef = listing?.default ?? null;
  return (
    <>
      <SearchList
        className={className}
        listClassName={listClassName}
        label="Search models"
        placeholder="Search models"
        inputRef={inputRef}
        items={rows}
        query={query}
        onQueryChange={onQueryChange}
        activeId={active?.id ?? null}
        onActiveChange={onActiveChange}
        onActivate={(row) => onActivate(row.model)}
        empty={empty}
        after={
          <>
            {folded ? (
              <div className="px-3 pt-2">
                <Button size="sm" onClick={() => setExpanded(true)}>
                  Show all {all.length} models
                </Button>
              </div>
            ) : null}
            {after}
          </>
        }
        renderItem={(row, { active: highlighted }) => {
          const note = notes?.get(row.model.ref);
          return (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ModelRow
                  model={row.model}
                  providerMissing={
                    listing !== null &&
                    providerMissing(listing, row.model.provider)
                  }
                  current={namesModel(row.model, profile)}
                  isDefault={namesModel(row.model, defaultRef)}
                  category={category}
                  pull={pulls.active.get(row.model.ref)}
                  failed={pulls.failed.get(row.model.ref)}
                  tag={note?.tag}
                  note={note?.reason}
                  estimate={note?.estimate}
                />
              </div>
              {onTune === undefined ||
              (tunable !== undefined && !tunable(row.model)) ? null : (
                // A button cannot sit inside an option, so this is for the mouse; the keyboard has the Tune button
                // of the actions below, and a screen reader does not hear this one.
                <span
                  aria-hidden="true"
                  onClick={(event) => {
                    event.stopPropagation();
                    onTune(row.model);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className={cn(
                    ROW_BUTTON,
                    highlighted
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  <SlidersIcon />
                  Tune
                </span>
              )}
              {onStop === undefined || row.model.status !== "pulling" ? null : (
                <span
                  aria-hidden="true"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStop(row.model);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className={ROW_BUTTON}
                >
                  Stop
                </span>
              )}
            </div>
          );
        }}
      />
      {footer}
    </>
  );
}
