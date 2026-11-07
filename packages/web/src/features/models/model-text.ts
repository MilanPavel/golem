import { pullSpeed, timeLeft, withPulls, type PullState } from "@golem/view";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import type { PullEntry, PullsSnapshot } from "../../store/pulls.ts";

/** The model's name without its provider: `qwen3:8b` for `ollama/qwen3:8b`. */
export function shortName(ref: string): string {
  return ref.slice(ref.indexOf("/") + 1);
}

function gb(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

/** The share of a download, 0 to 1, or null when nobody knows yet. */
export function pullShare(entry: PullEntry | undefined, listed: number | null | undefined): number | null {
  const track = entry?.track;
  if (track !== undefined && track.total !== null && track.total > 0) {
    return Math.min(1, track.completed / track.total);
  }
  return entry?.progress ?? listed ?? null;
}

/** `2.1 / 6.6 GB · 12 MB/s · 6 min`, with what is known so far. */
export function pullText(entry: PullEntry | undefined): string {
  if (entry === undefined) {
    return "starting…";
  }
  const { track } = entry;
  const parts: string[] = [];
  if (track.total !== null && track.total > 0) {
    parts.push(`${gb(track.completed)} / ${gb(track.total)} GB`);
  } else if (track.completed > 0) {
    parts.push(`${gb(track.completed)} GB`);
  }
  const speed = pullSpeed(track);
  if (speed !== null) {
    parts.push(`${Math.round(speed / 1e6)} MB/s`);
    if (track.total !== null && track.total > track.completed) {
      parts.push(timeLeft((track.total - track.completed) / speed));
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "starting…";
}

function sizeText(model: ListedModel): string {
  return model.size_gb === null || model.size_gb === undefined ? "size unknown" : `${model.size_gb} GB`;
}

function memoryText(listing: ModelListResult): string {
  return listing.ram_gb === null || listing.ram_gb === undefined ? "this Mac" : `${listing.ram_gb} GB of memory`;
}

/** The first question for a model too big for this machine, or null when it fits. */
export function tooBigText(model: ListedModel, listing: ModelListResult): string | null {
  return model.fit === "too_big" ? `${shortName(model.ref)} (${sizeText(model)}) is too big for ${memoryText(listing)}.` : null;
}

/** `Download qwen3:8b (5.2 GB, fits) and use it?` */
export function downloadText(model: ListedModel): string {
  const fit = model.fit === null || model.fit === undefined ? "" : `, ${model.fit === "too_big" ? "too big" : model.fit}`;
  return `Download ${shortName(model.ref)} (${sizeText(model)}${fit}) and use it?`;
}

/** A warning when the disk may not hold the download, else null. */
export function diskText(model: ListedModel, listing: ModelListResult): string | null {
  const free = listing.disk_free_gb;
  const size = model.size_gb;
  if (free === null || free === undefined || size === null || size === undefined || free >= size) {
    return null;
  }
  return `Only ${free} GB free on disk.`;
}

/** `Remove qwen3:8b from Ollama? It frees 5.2 GB.` */
export function removeText(model: ListedModel): string {
  const frees = model.size_gb === null || model.size_gb === undefined ? "" : ` It frees ${model.size_gb} GB.`;
  return `Remove ${shortName(model.ref)} from Ollama?${frees}`;
}

/** An installed Ollama model: the one kind golem can remove. */
export function removable(model: ListedModel): boolean {
  return model.source === "installed" && model.provider === "ollama";
}

/** The listing with the downloads in flight laid over it, as `withPulls` wants them. */
export function withActivePulls(listing: ModelListResult | null, pulls: PullsSnapshot): ModelListResult | null {
  const record: Record<string, PullState> = {};
  for (const [ref, entry] of pulls.active) {
    record[ref] = { progress: pullShare(entry, null), status: entry.status };
  }
  return withPulls(listing, record);
}

/** What the sidebar's download row says. `ref` names the download a failed row is about. */
export type PullSummary = {
  kind: "one" | "many" | "failed";
  title: string;
  share: number | null;
  text: string;
  /** What a screen reader says of it: `Downloading Qwen3, 12 percent, 38 minutes left`. */
  spoken: string;
  ref?: string;
};

function secondsLeft(entry: PullEntry): number | null {
  const { track } = entry;
  const speed = pullSpeed(track);
  if (speed === null || track.total === null || track.total <= track.completed) {
    return null;
  }
  return (track.total - track.completed) / speed;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function percentText(share: number | null): string | null {
  return share === null ? null : `${Math.floor(share * 100)}%`;
}

/**
 * The one line of the sidebar's download row, or null when there is nothing to show. With
 * downloads running it is about them; with none it is about the first failure. A stop is not a
 * failure. `labels` maps a ref to its name, and a ref without one is shown as it is.
 */
export function pullSummary(
  active: ReadonlyMap<string, PullEntry>,
  failed: ReadonlyMap<string, string>,
  labels: ReadonlyMap<string, string>,
): PullSummary | null {
  const name = (ref: string) => labels.get(ref) ?? ref;
  const entries = [...active.entries()];
  if (entries.length === 0) {
    const first = [...failed.entries()].find(([, error]) => error !== "cancelled");
    return first === undefined
      ? null
      : {
          kind: "failed",
          title: `Download of ${name(first[0])} failed`,
          share: null,
          text: first[1],
          spoken: `Download of ${name(first[0])} failed: ${first[1]}`,
          ref: first[0],
        };
  }
  let completed = 0;
  let total = 0;
  let longest: number | null = null;
  for (const [, entry] of entries) {
    if (entry.track.total !== null && entry.track.total > 0) {
      completed += Math.min(entry.track.completed, entry.track.total);
      total += entry.track.total;
    }
    const left = secondsLeft(entry);
    if (left !== null && (longest === null || left > longest)) {
      longest = left;
    }
  }
  const one = entries.length === 1 ? entries[0] : undefined;
  const share = one === undefined ? (total > 0 ? completed / total : null) : pullShare(one[1], null);
  const text = [percentText(share), longest === null ? null : timeLeft(longest)].filter((part) => part !== null).join(" · ");
  const title = one === undefined ? `${entries.length} downloads` : name(one[0]);
  const said = text
    .replace("%", " percent")
    .replace(" · ", ", ")
    .replace(/(\d+) h (\d+) min$/, (_, h: string, m: string) => `${plural(Number(h), "hour")} ${plural(Number(m), "minute")}`)
    .replace(/(\d+) min$/, (_, m: string) => plural(Number(m), "minute"));
  return {
    kind: one === undefined ? "many" : "one",
    title,
    share,
    text: text === "" ? "starting…" : text,
    spoken: `Downloading ${title}${text === "" ? "" : `, ${said}${longest === null ? "" : " left"}`}`,
  };
}
