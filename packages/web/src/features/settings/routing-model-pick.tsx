import { namesModel, pickerGroups } from "@golem/view";
import { useMemo, useState } from "react";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { resolveActive } from "../../ui/search-list.tsx";
import { listRows, ModelList } from "../models/index.ts";

export type ModelPickProps = {
  /** The name of the setting, for a screen reader. */
  label: string;
  /** The model the setting holds, or null when it is empty. */
  value: string | null;
  /** The listing the choices come from, and the models of it that may be chosen. */
  listing: ModelListResult | null;
  models: readonly ListedModel[];
  pulls: PullsSnapshot;
  /** What an empty setting says: `Auto · qwen3:27b`, `Automatic`. */
  emptyText: string;
  onPick: (ref: string | null) => void;
  describedBy?: string;
  invalid?: boolean;
  /** Extra classes of the button. */
  className?: string;
};

/**
 * A setting that names a model: a button with the current choice, and under it a searchable list
 * of the models it may hold, with the empty choice first. Models of another kind are not listed.
 */
export function ModelPick({ label, value, listing, models, pulls, emptyText, onPick, describedBy, invalid, className }: ModelPickProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const shown = useMemo(() => (listing === null ? [] : pickerGroups({ ...listing, models: [...models] }, query)), [listing, models, query]);
  const active = resolveActive(listRows(shown), activeId);
  const current = value === null ? emptyText : (models.find((model) => namesModel(model, value))?.label ?? value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button aria-label={`${label}: ${current}`} aria-describedby={describedBy} aria-invalid={invalid === true ? true : undefined} className={cn("max-w-full justify-start", className)}>
          <span className="truncate">{current}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-96 w-md max-w-full flex-col gap-2 p-2">
        <PopoverClose asChild>
          <Button size="sm" aria-pressed={value === null} className="justify-start" onClick={() => onPick(null)}>
            {emptyText}
          </Button>
        </PopoverClose>
        <ModelList
          listing={listing}
          groups={shown}
          profile={value}
          category={null}
          pulls={pulls}
          query={query}
          onQueryChange={setQuery}
          activeId={activeId}
          onActiveChange={setActiveId}
          onActivate={(model) => {
            onPick(model.ref);
            setOpen(false);
          }}
          empty={<p className="px-3 py-2 text-sm text-muted">No model of this kind.</p>}
          footer={
            <div className="flex justify-end">
              <Button
                kind="primary"
                size="sm"
                disabled={active === null}
                onClick={() => {
                  if (active === null) return;
                  onPick(active.model.ref);
                  setOpen(false);
                }}
              >
                Use this model
              </Button>
            </div>
          }
          className="min-h-0 flex-1"
          listClassName="max-h-64"
        />
      </PopoverContent>
    </Popover>
  );
}
