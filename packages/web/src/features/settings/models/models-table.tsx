import { namesModel } from "@golem/view";
import type { ListedModel } from "../../../store/models.ts";
import type { PullEntry, PullsSnapshot } from "../../../store/pulls.ts";
import { Badge } from "../../../ui/badge.tsx";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { Code } from "../../../ui/code.tsx";
import { pullShare, pullText, shortName } from "../../models/model-text.ts";
import { PullBar } from "../../models/pull-bar.tsx";
import { priceText, providerEntry, speedText, toolsText } from "./derive.ts";

export type ModelTableProps = {
  /** What the table is, for screen readers. */
  label: string;
  models: readonly ListedModel[];
  /** The model new chats start on: the one that gets the DEFAULT tag. */
  defaultName: string | null;
  /** Adds a Provider column: the table mixes providers. */
  showProvider?: boolean;
  /** The table is Ollama's: it has Speed here and Remove, and shows downloads. */
  local?: boolean;
  pulls: PullsSnapshot;
  /** A call is on its way: the buttons wait for it. */
  busy: boolean;
  onStar: (model: ListedModel) => void;
  onRemove?: (model: ListedModel) => void;
  onStop?: (model: ListedModel) => void;
};

const TH = "px-3 py-2 text-left text-meta font-semibold tracking-wide text-faint uppercase";
const TD = "px-3 py-2 align-middle";

/** The star: on is clay and a filled star, off an outline. It is a toggle, so its name stays the same. */
function Star({ model, busy, onStar }: { model: ListedModel; busy: boolean; onStar: (model: ListedModel) => void }) {
  const on = model.starred === true;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`Show ${model.label} in the model menu`}
      title={on ? "In the model menu" : "Not in the model menu"}
      disabled={busy}
      onClick={() => {
        onStar(model);
      }}
      className={cn(
        "grid size-7 place-items-center rounded-sm text-base outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2 disabled:opacity-50",
        on ? "text-clay-ink" : "text-faint",
      )}
    >
      <span aria-hidden="true">{on ? "★" : "☆"}</span>
    </button>
  );
}

function Pulling({ model, entry, onStop, busy }: { model: ListedModel; entry: PullEntry | undefined; onStop?: (model: ListedModel) => void; busy: boolean }) {
  return (
    <tr className="border-t border-line">
      <td className={TD} />
      <td className={TD}>
        <Code>{shortName(model.ref)}</Code>
        <small className="block text-sm text-faint">Downloading</small>
      </td>
      <td className={TD} colSpan={3}>
        <PullBar label={`Downloading ${shortName(model.ref)}`} share={pullShare(entry, model.progress)} text={pullText(entry)} />
      </td>
      <td className={cn(TD, "text-right")}>
        {onStop === undefined ? null : (
          <Button
            size="sm"
            kind="ghost"
            disabled={busy}
            onClick={() => {
              onStop(model);
            }}
            aria-label={`Stop downloading ${shortName(model.ref)}`}
          >
            Stop
          </Button>
        )}
      </td>
    </tr>
  );
}

/**
 * The table of models: ★ to put one in the model menu, the model, its tools check and its price per million
 * tokens in and out. Ollama's has Speed here and Remove, and a row for each download.
 */
export function ModelTable({ label, models, defaultName, showProvider = false, local = false, pulls, busy, onStar, onRemove, onStop }: ModelTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-sunken">
          <tr>
            <th scope="col" className={cn(TH, "w-10")}>
              <span className="sr-only">Star</span>
            </th>
            <th scope="col" className={TH}>
              Model
            </th>
            {showProvider ? (
              <th scope="col" className={TH}>
                Provider
              </th>
            ) : null}
            {local ? (
              <th scope="col" className={cn(TH, "hidden lg:table-cell")}>
                Speed here
              </th>
            ) : null}
            <th scope="col" className={cn(TH, "hidden sm:table-cell")}>
              Tools
            </th>
            <th scope="col" className={TH}>
              Price per million tokens
            </th>
            {local ? (
              <th scope="col" className={cn(TH, "w-20")}>
                <span className="sr-only">Remove</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            if (model.status === "pulling") {
              return <Pulling key={model.ref} model={model} entry={pulls.active.get(model.ref)} onStop={onStop} busy={busy} />;
            }
            const tools = toolsText(model);
            const size = model.size_gb === null || model.size_gb === undefined ? "" : ` · ${model.size_gb} GB`;
            return (
              <tr key={model.ref} className="border-t border-line">
                <td className={TD}>
                  <Star model={model} busy={busy} onStar={onStar} />
                </td>
                <td className={TD}>
                  <span className="flex flex-wrap items-center gap-x-2">
                    <Code>{shortName(model.ref)}</Code>
                    {namesModel(model, defaultName) ? (
                      <Badge tone="clay" className="px-1.5 py-0">
                        DEFAULT
                      </Badge>
                    ) : null}
                  </span>
                  <small className="block text-sm text-faint">{`${model.label}${size}`}</small>
                </td>
                {showProvider ? <td className={TD}>{providerEntry(model.provider)?.name ?? model.provider}</td> : null}
                {local ? <td className={cn(TD, "hidden lg:table-cell")}>
                    <Code>{speedText(model)}</Code>
                  </td> : null}
                <td className={cn(TD, "hidden sm:table-cell")}>
                  <span title={tools.text} className={model.tools === true ? "text-allow" : "text-muted"}>
                    {tools.mark}
                    <span className="sr-only">{`: ${tools.text}`}</span>
                  </span>
                </td>
                <td className={TD}>
                  <Code>{priceText(model)}</Code>
                </td>
                {local ? (
                  <td className={cn(TD, "text-right")}>
                    {onRemove === undefined ? null : (
                      <Button
                        size="sm"
                        kind="ghost"
                        disabled={busy}
                        onClick={() => {
                          onRemove(model);
                        }}
                        aria-label={`Remove ${model.label}`}
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
