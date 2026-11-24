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

type Words = ReturnType<typeof quantWords>;
type Candidate = { quant: string; sizeGb: number; recommended: boolean; index: number };

/** Which of several sizes with one plain name keeps it: the recommended one, then the biggest "Largest" or the smallest "Smallest", then a `_M` one, then the shortest code, then the first listed. */
function keeper(group: readonly Candidate[], title: string): number {
  const rank = (size: Candidate): number[] => [
    size.recommended ? 0 : 1,
    title === "Largest" ? -size.sizeGb : title === "Smallest" ? size.sizeGb : 0,
    /_M$/i.test(size.quant) ? 0 : 1,
    size.quant.length,
    size.index,
  ];
  const better = (a: Candidate, b: Candidate): Candidate => {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i += 1) {
      const diff = (x[i] ?? 0) - (y[i] ?? 0);
      if (diff !== 0) return diff < 0 ? a : b;
    }
    return a;
  };
  return group.reduce(better).index;
}

/**
 * The words of each size of one repo, in the order given. A plain name belongs to one size only: when several sizes
 * map to the same one (`Q8` and `Q8_0_V2`, or `Q4_K_M` and `Q4_K_S`), `keeper` says which keeps it, and the others are
 * titled by their code, which keeps the line about what the size means.
 */
export function sizeWords(sizes: readonly { quant: string; sizeGb: number; recommended: boolean }[]): Words[] {
  const words = sizes.map((size) => quantWords(size.quant));
  const groups = new Map<string, Candidate[]>();
  sizes.forEach((size, index) => {
    const word = words[index];
    if (word?.code !== undefined) groups.set(word.title, [...(groups.get(word.title) ?? []), { ...size, index }]);
  });
  for (const [title, group] of groups) {
    if (group.length < 2) continue;
    const winner = keeper(group, title);
    for (const { index } of group) {
      const word = words[index];
      if (index !== winner && word?.code !== undefined) words[index] = { title: word.code, note: word.note };
    }
  }
  return words;
}

/** The sizes of a repo as rows, with which are installed already. */
export function hfSizeItems(repo: string, files: HfFilesResult, listing: ModelListResult | null): SizeItem[] {
  const installed = new Set((listing?.models ?? []).filter((model) => model.source === "installed" && model.status === "ready").map((model) => model.ref));
  const words = sizeWords(files.sizes.map((size) => ({ quant: size.quant, sizeGb: size.size_gb, recommended: size.recommended })));
  return files.sizes.map((size, index) => {
    const ref = hfRef(repo, size.quant);
    return { key: size.quant, ...(words[index] ?? quantWords(size.quant)), sizeGb: size.size_gb, fit: size.fit, ref, name: size.quant, recommended: size.recommended, installed: installed.has(ref), ...(size.problem == null ? {} : { problem: size.problem }) };
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
