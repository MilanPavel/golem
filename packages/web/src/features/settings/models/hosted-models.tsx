import { useState } from "react";
import type { ListedModel } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Button } from "../../../ui/button.tsx";
import { isStarred } from "./derive.ts";
import { ModelTable } from "./models-table.tsx";

export type HostedModelsProps = {
  providerName: string;
  models: readonly ListedModel[];
  defaultName: string | null;
  pulls: PullsSnapshot;
  busy: boolean;
  onStar: (model: ListedModel) => void;
};

/**
 * A hosted provider's models: the starred ones, and the rest behind "Show all". A model unstarred
 * here keeps its row until another provider is picked (the parent keys this by provider).
 */
export function HostedModels({ providerName, models, defaultName, pulls, busy, onStar }: HostedModelsProps) {
  const [showAll, setShowAll] = useState(false);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const starredCount = models.filter(isStarred).length;
  const all = showAll || starredCount === 0;
  const rows = all ? models : models.filter((model) => isStarred(model) || kept.has(model.ref));
  const star = (model: ListedModel): void => {
    if (isStarred(model)) setKept((before) => new Set(before).add(model.ref));
    onStar(model);
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted">{starredCount === 0 ? `None of ${models.length} starred` : `${starredCount} of ${models.length} starred`}</p>
        {starredCount === 0 || starredCount === models.length ? null : (
          <Button
            size="sm"
            kind="ghost"
            aria-pressed={showAll}
            onClick={() => {
              setShowAll(!showAll);
            }}
          >
            {showAll ? "Show starred only" : `Show all ${models.length}`}
          </Button>
        )}
      </div>
      <ModelTable label={`${providerName} models`} models={rows} defaultName={defaultName} pulls={pulls} busy={busy} onStar={star} />
    </>
  );
}
