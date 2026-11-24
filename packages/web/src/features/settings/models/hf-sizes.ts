import type { HfFilesResult, HfRepo, ModelListResult } from "../../../store/models.ts";
import type { SizeItem } from "./get-models-split.tsx";

/** The ref `model.pull` takes for one size of a repo. */
export function hfRef(repo: string, quant: string): string {
  return `ollama/hf.co/${repo}:${quant}`;
}

/** What a size code means, in plain words. The code stays beside the name. */
const QUANTS: Record<string, [string, string]> = {
  "8": ["Largest", "As good as the original."],
  "6": ["Large", "Very close to the original."],
  "5": ["Larger", "A little better than balanced."],
  "4": ["Balanced", "The usual pick: good answers, half the size."],
  "3": ["Small", "Some quality is lost."],
  "2": ["Smallest", "Clearly worse answers. A last resort."],
};

/** The plain name and the line for a size code. A code that is not a plain Q-number shows as it is. */
export function quantWords(code: string): { title: string; code?: string; note: string } {
  const found = /^Q([2-8])/.exec(code.toUpperCase());
  const words = found === null ? undefined : QUANTS[found[1] ?? ""];
  return words === undefined ? { title: code, note: "" } : { title: words[0], code, note: words[1] };
}

/** The sizes of a repo as rows, with which are installed already. */
export function hfSizeItems(repo: string, files: HfFilesResult, listing: ModelListResult | null): SizeItem[] {
  const installed = new Set((listing?.models ?? []).filter((model) => model.source === "installed" && model.status === "ready").map((model) => model.ref));
  return files.sizes.map((size) => {
    const ref = hfRef(repo, size.quant);
    return { key: size.quant, ...quantWords(size.quant), sizeGb: size.size_gb, fit: size.fit, ref, name: size.quant, recommended: size.recommended, installed: installed.has(ref) };
  });
}

/** The number of parameters when the repo's name says it: `27B` in `Qwen3.8-27B-Instruct-GGUF`. */
export function paramsOf(name: string): string | null {
  const found = /(?<![\w.])(\d+(?:\.\d+)?)b(?![a-z0-9])/i.exec(name);
  return found === null ? null : `${found[1] ?? ""}B`;
}

export function shortCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

/** `Nov 19`, with the year when it is not this one. Null when the date is not known. */
export function shortDate(updated: string | null | undefined, now: Date): string | null {
  if (updated === null || updated === undefined) return null;
  const date = new Date(updated);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

export function splitRepo(repo: Pick<HfRepo, "id">): { owner: string; name: string } {
  const slash = repo.id.indexOf("/");
  return slash < 0 ? { owner: "", name: repo.id } : { owner: repo.id.slice(0, slash), name: repo.id.slice(slash + 1) };
}
