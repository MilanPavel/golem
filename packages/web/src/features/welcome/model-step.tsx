import { namesModel, pickerGroups, providerMissing, type PickerGroup } from "@golem/view";
import { useMemo, useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";
import { Button } from "../../ui/button.tsx";
import { ModelList, tooBigText, withActivePulls, type ModelListNote } from "../models/index.ts";

export type ModelStepProps = {
  /** The listing the rows come from, or null while it loads. */
  listing: ModelListResult | null;
  /** The downloads in flight: a running one shows its bar and Stop in its row. */
  pulls: PullsSnapshot;
  /** Bytes a second of the last download that was measured, or null when none was. The time estimates come from it. */
  speed: number | null;
  /** Starts the download of a model that is not installed, then goes on to the next step. Rejects with the daemon's message. */
  onDownload: (model: ListedModel) => Promise<void>;
  /** Makes an installed model the default, then goes on. Rejects with the daemon's message. */
  onUse: (model: ListedModel) => Promise<void>;
  /** Stops a download. */
  onStop: (model: ListedModel) => Promise<void>;
  /** Goes on while the picked model downloads. */
  onContinue: () => void;
};

/** `≈ 2 min`, from a size in GB and a speed in bytes a second. Null when either is not known. */
export function estimateText(sizeGb: number | null | undefined, speed: number | null): string | null {
  if (sizeGb === null || sizeGb === undefined || speed === null || speed <= 0) return null;
  const minutes = Math.max(1, Math.round((sizeGb * 1e9) / speed / 60));
  return minutes < 60 ? `≈ ${minutes} min` : `≈ ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const NAMES: Record<string, string> = {
  coding: "code",
  reasoning: "reasoning",
  vision: "images",
  fast: "speed",
  "long-context": "long documents",
};

/** One line on why a model is in the leading group, from what the listing says of it. Null when it says nothing. */
function reasonOf(model: ListedModel): string | null {
  if (model.recommended === true) return "The one golem suggests for this Mac.";
  const picks = (model.recommended_for ?? []).map((each) => NAMES[each]).filter((each) => each !== undefined);
  if (picks.length > 0) return `The best for ${picks.join(" and ")} that fits this Mac.`;
  const traits = (model.categories ?? []).map((each) => NAMES[each]).filter((each) => each !== undefined);
  return traits.length > 0 ? `Good at ${traits.join(" and ")}.` : null;
}

/** The most models the leading group shows: the recommended one and the next two that fit. */
const LEADING = 3;

/** The models that fit this Mac, the recommended one first, and no more than `LEADING`. */
function fitting(models: readonly ListedModel[]): ListedModel[] {
  const fits = models.filter((model) => model.fit === "fits");
  return [...fits.filter((model) => model.recommended === true), ...fits.filter((model) => model.recommended !== true)].slice(0, LEADING);
}

/** The model the step opens on when there is one in play: the one downloading, else the default if it is ready. */
function inPlay(listing: ModelListResult | null, models: readonly ListedModel[], pulls: PullsSnapshot): ListedModel | null {
  if (listing === null) return null;
  const running = models.find((model) => pulls.active.has(model.ref));
  return running ?? models.find((model) => model.status === "ready" && namesModel(model, listing.default)) ?? null;
}

/** The leading models with `pinned` among them, after the recommended one, so a model in play is never behind Show all. */
function withPinned(fits: readonly ListedModel[], pinned: ListedModel | null): ListedModel[] {
  if (pinned === null || fits.length === 0 || fits.includes(pinned)) return [...fits];
  const at = fits[0]?.recommended === true ? 1 : 0;
  return [...fits.slice(0, at), pinned, ...fits.slice(at)];
}

/**
 * Model: one good model for this Mac, picked in one click. The list is the model dialog's, with
 * the models that fit this Mac first and the recommended one selected; the rest sit behind `Show
 * all`. The button starts the download and goes on, so the person does not wait for it.
 */
export function ModelStep({ listing, pulls, speed, onDownload, onUse, onStop, onContinue }: ModelStepProps) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => withActivePulls(listing, pulls), [listing, pulls]);
  const groups = useMemo(() => (shown === null ? [] : pickerGroups(shown, query, null)), [shown, query]);
  const listed = useMemo(() => groups.flatMap((group) => group.models), [groups]);
  const played = inPlay(shown, listed, pulls);
  const fits = useMemo(() => withPinned(fitting(listed), played), [listed, played]);
  const ram = shown?.ram_gb ?? null;
  const leading: PickerGroup | undefined =
    fits.length === 0 ? undefined : { title: ram === null ? "Fits this Mac" : `Fits this Mac · ${ram} GB memory`, models: fits };

  const notes = useMemo(() => {
    const out = new Map<string, ModelListNote>();
    for (const model of fits) {
      const reason = reasonOf(model);
      out.set(model.ref, { ...(reason === null ? {} : { reason }) });
    }
    for (const model of listed) {
      const estimate = model.status === "not_installed" ? estimateText(model.size_gb, speed) : null;
      if (estimate !== null) out.set(model.ref, { ...out.get(model.ref), estimate });
    }
    return out;
  }, [fits, listed, speed]);

  const rows = leading === undefined ? listed : [...fits, ...listed.filter((model) => !fits.includes(model))];
  const selectedRef = activeId !== null && rows.some((model) => model.ref === activeId) ? activeId : (played ?? rows.find((each) => each.recommended === true) ?? rows[0])?.ref ?? null;
  const model = rows.find((each) => each.ref === selectedRef) ?? null;
  const missing = model !== null && shown !== null && providerMissing(shown, model.provider);
  const tooBig = model !== null && shown !== null && model.status === "not_installed" ? tooBigText(model, shown) : null;

  const kind: "download" | "use" | "going" | "none" =
    model === null
      ? "none"
      : model.status === "pulling"
        ? "going"
        : model.status === "ready"
          ? "use"
          : model.status === "not_installed" && !missing && tooBig === null
            ? "download"
            : "none";

  async function run(action: () => Promise<void>, fallback: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(actionErrorText(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  function primary(): void {
    if (model === null) return;
    if (kind === "going") onContinue();
    else if (kind === "use") void run(() => onUse(model), "Could not make it the default.");
    else if (kind === "download") void run(() => onDownload(model), "Could not start the download.");
  }

  const footer = (
    <div className="mt-4 flex flex-col items-center gap-3">
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {tooBig === null ? null : <p className="text-sm text-deny">{tooBig}</p>}
      <Button kind={kind === "none" ? "secondary" : "ink"} disabled={kind === "none" || busy} onClick={primary}>
        {kind === "download" || kind === "none" ? "Download and continue" : "Continue"}
      </Button>
    </div>
  );

  return (
    <>
      <h2 className="font-prose text-2xl font-normal tracking-tight text-balance">Pick a model</h2>
      <p className="-mt-2 max-w-md text-balance text-muted">It downloads in the background. You can keep going while it does.</p>
      <div className="flex w-full flex-col text-left">
        <ModelList
          listing={shown}
          groups={groups}
          {...(leading === undefined ? {} : { leading })}
          notes={notes}
          {...(leading === undefined || query !== "" ? {} : { collapse: { keep: fits.length } })}
          profile={null}
          category={null}
          pulls={pulls}
          query={query}
          onQueryChange={setQuery}
          activeId={selectedRef}
          onActiveChange={(id) => {
            setActiveId(id);
            setError(null);
          }}
          onActivate={primary}
          onStop={(each) => void run(() => onStop(each), "Could not stop the download.")}
          empty={
            <p role={shown === null ? "status" : undefined} className="px-3 py-6 text-center text-sm text-muted">
              {shown === null ? "Loading models…" : query === "" ? "No models found." : "No matching models."}
            </p>
          }
          footer={footer}
        />
      </div>
    </>
  );
}
