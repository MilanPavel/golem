import { categoryName, contextLabel, priceLabel, sizeLabel, statusLabel } from "@golem/view";
import type { ReactNode } from "react";
import type { ListedModel } from "../../store/models.ts";
import type { PullEntry } from "../../store/pulls.ts";
import { Badge } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";
import { CheckIcon } from "../../ui/icons.tsx";
import { PullBar } from "./pull-bar.tsx";
import { pullShare, pullText, shortName } from "./model-text.ts";

function Command({ children }: { children: ReactNode }) {
  return <code className="font-mono text-ink">{children}</code>;
}

/** Why a model cannot be used yet, in words for a page that never takes a key. Null when it can be. */
function reason(model: ListedModel, providerMissing: boolean): ReactNode {
  switch (model.status) {
    case "ready":
    case "pulling":
      return null;
    case "needs_key":
      return (
        <>
          Needs a key: run <Command>golem auth set {model.provider}</Command>
        </>
      );
    case "not_installed":
      return providerMissing ? (
        <>
          Ollama is not installed. Run <Command>golem</Command>, then <Command>/setup</Command>.
        </>
      ) : (
        "Not downloaded yet"
      );
    case "server_down":
      return model.provider === "ollama" ? (
        <>
          Ollama is not answering. Run <Command>ollama serve</Command>.
        </>
      ) : (
        `${model.provider} is not answering.`
      );
  }
}

function Progress({ model, entry }: { model: ListedModel; entry: PullEntry | undefined }) {
  return <PullBar label={`Downloading ${shortName(model.ref)}`} share={pullShare(entry, model.progress)} text={pullText(entry)} />;
}

export type ModelRowProps = {
  model: ListedModel;
  /** The model's provider is a local server whose program is not on this Mac. */
  providerMissing: boolean;
  /** The session uses it. */
  current: boolean;
  /** New sessions use it. */
  isDefault: boolean;
  /** The download in flight, from the pulls store. */
  pull: PullEntry | undefined;
  /** Why the last download failed. */
  failed: string | undefined;
};

/** One line of the list: the name, the facts, and under them what stops it or how far it is. */
export function ModelRow({ model, providerMissing, current, isDefault, pull, failed }: ModelRowProps) {
  const profiles = model.profiles ?? [];
  const label = profiles.length > 0 ? profiles.join(", ") : model.label;
  const detail = profiles.length > 0 || model.label !== model.ref ? model.ref : "";
  const facts = [contextLabel(model.ctx), priceLabel(model), sizeLabel(model), statusLabel(model, providerMissing)]
    .filter((part) => part.length > 0)
    .join("  ");
  // General is what every model is without another mark, so it is left to the filter.
  const categories = (model.categories ?? []).filter((category) => category !== "general");
  const why = reason(model, providerMissing);
  const ready = model.status === "ready";
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-allow">
        {current ? (
          <>
            <CheckIcon />
            <span className="sr-only">current</span>
          </>
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("text-sm font-medium", ready ? "text-ink" : "text-muted")}>{label}</span>
          {detail === "" ? null : <span className="font-mono text-xs text-faint">{detail}</span>}
          {isDefault ? <Badge className="px-1.5 py-0">default</Badge> : null}
          {categories.map((category) => (
            <Badge key={category} className="px-1.5 py-0 text-faint">
              {categoryName(category)}
            </Badge>
          ))}
        </div>
        {why === null ? null : <p className="mt-0.5 text-xs text-muted">{why}</p>}
        {model.status === "pulling" ? <Progress model={model} entry={pull} /> : null}
        {failed === undefined ? null : <p className="mt-0.5 text-xs text-deny">Download failed: {failed}</p>}
      </div>
      <span className="max-w-48 text-right font-mono text-xs text-muted">{facts}</span>
    </div>
  );
}
