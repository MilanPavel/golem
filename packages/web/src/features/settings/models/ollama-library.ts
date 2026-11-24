import { useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { OllamaLibraryModel, OllamaLibraryResult } from "../../../store/models.ts";
import type { SizeItem } from "./get-models-split.tsx";

/** What the Ollama library needs of the page. The call rejects with the daemon's message. */
export type OllamaLibraryActions = {
  /** An empty query lists the whole list. A name that is not in the list is asked of the Ollama registry. */
  search(query: string): Promise<OllamaLibraryResult>;
};

/** The state a library tab starts in, for the gallery. */
export type OllamaLibraryInitial = {
  /** The whole list. */
  results: OllamaLibraryResult;
  /** The name that is chosen. */
  chosen?: string;
  /** In a narrow pane: the detail is the one showing. */
  open?: boolean;
  /** What the registry said for a name outside the list. */
  found?: { query: string; results: OllamaLibraryResult };
};

/** The text of the search as the library reads it: no spaces, small letters, no `ollama/`. */
export function libraryQuery(text: string): string {
  return text.trim().toLowerCase().replace(/^ollama\//, "");
}

/** The names the text matches, the exact one first, then the ones that start with it, then the ones that hold it. `name:tag` matches by its name. */
export function libraryRows(all: readonly OllamaLibraryModel[], text: string): OllamaLibraryModel[] {
  const needle = libraryQuery(text).split(":")[0] ?? "";
  if (needle === "") return [...all];
  const rank = (name: string): number | null => (name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : null);
  return all
    .map((model, index) => ({ model, index, rank: rank(model.name) }))
    .filter((row) => row.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.index - b.index)
    .map((row) => row.model);
}

/** The ref `model.pull` takes for one size of a name. */
export function libraryRef(name: string, tag: string): string {
  return `ollama/${name}:${tag}`;
}

/** "3 sizes · from 3.1 GB". */
export function sizesLine(model: OllamaLibraryModel): string {
  const count = model.sizes.length;
  if (count === 0) return "no sizes";
  const smallest = Math.min(...model.sizes.map((size) => size.size_gb));
  return `${count === 1 ? "1 size" : `${count} sizes`} · from ${smallest} GB`;
}

/** The sizes of a name as rows. */
export function librarySizeItems(model: OllamaLibraryModel): SizeItem[] {
  return model.sizes.map((size) => ({
    key: size.tag,
    title: size.tag,
    code: `${model.name}:${size.tag}`,
    note: "",
    sizeGb: size.size_gb,
    fit: size.fit,
    ref: libraryRef(model.name, size.tag),
    name: `${model.name}:${size.tag}`,
    recommended: size.recommended,
    installed: size.installed,
  }));
}

/** Where a name has its page on ollama.com. A name with an owner is `owner/name`. */
export function libraryUrl(name: string): string {
  return name.includes("/") ? `https://ollama.com/${name}` : `https://ollama.com/library/${name}`;
}

export type LibraryList = {
  /** The whole list, or null before it came. */
  all: readonly OllamaLibraryModel[] | null;
  /** The words of why it did not come. */
  error: string | null;
};

/**
 * The whole list of names, asked once when the page opens: it is the daemon's own list, so nothing leaves this Mac.
 * With a state to start in, the list is the one that state already holds. A ref, so strict mode's second run skips it too.
 */
export function useLibraryList(library: OllamaLibraryActions, initial?: OllamaLibraryInitial): LibraryList {
  const [all, setAll] = useState<readonly OllamaLibraryModel[] | null>(initial?.results.models ?? null);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(initial !== undefined);
  useEffect(() => {
    if (seeded.current) return;
    let live = true;
    library.search("").then(
      (found) => {
        if (!live) return;
        setAll(found.models);
        setError(null);
      },
      (caught: unknown) => {
        if (live) setError(actionErrorText(caught, "Could not read the Ollama library."));
      },
    );
    return () => {
      live = false;
    };
  }, [library]);
  return { all, error };
}
