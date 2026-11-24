import { useEffect, useMemo, useRef, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { ModelListResult, OllamaLibraryModel } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Button } from "../../../ui/button.tsx";
import { ProviderIcon } from "../../../ui/provider-icons.tsx";
import { Avatar, DetailHead, EmptyState, ResultList, ResultRow, SizeRows, SplitPane, useSplit } from "./get-models-split.tsx";
import { libraryQuery, libraryRows, librarySizeItems, libraryUrl, sizesLine, type LibraryList, type OllamaLibraryActions, type OllamaLibraryInitial } from "./ollama-library.ts";
import { useDebounced, type Timer } from "./use-debounced.ts";

export type OllamaLibraryTabProps = {
  library: OllamaLibraryActions;
  /** The whole list of names, which the page asked for. */
  list: LibraryList;
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  pull: (ref: string) => Promise<boolean>;
  onStop: (ref: string) => void;
  failure: string | null;
  /** The text of the page's search field. */
  search: string;
  /** Runs the same search on the Hugging Face tab. */
  onHuggingFace: () => void;
  /** How long the typing rests before the registry is asked about a name golem does not list. */
  delayMs?: number;
  /** A timer a test can move. */
  timer?: Timer;
  /** The state the tab starts in, for the gallery. */
  initial?: OllamaLibraryInitial;
};

const REST_MS = 400;

/** What the registry said for one name outside the list. */
type Answer = { query: string; models: readonly OllamaLibraryModel[] } | { query: string; error: string };

function OllamaMark({ size = 17 }: { size?: number }) {
  return <ProviderIcon provider="ollama" name="Ollama" width={size} height={size} />;
}

/**
 * The Ollama library tab of Get models: names on the left, the sizes of the chosen one on the right. The list is the
 * daemon's own, so the names filter as the text changes. A name outside it is asked of the registry after the typing rests.
 */
export function OllamaLibraryTab({ library, list, listing, pulls, pull, onStop, failure, search, onHuggingFace, delayMs = REST_MS, timer, initial }: OllamaLibraryTabProps) {
  const query = libraryQuery(search);
  const rested = useDebounced(query, delayMs, timer);
  const [answer, setAnswer] = useState<Answer | null>(initial?.found === undefined ? null : { query: initial.found.query, models: initial.found.results.models });
  const [chosen, setChosen] = useState<{ name: string; query: string } | null>(initial?.chosen === undefined ? null : { name: initial.chosen, query });
  const [kept, setKept] = useState<readonly OllamaLibraryModel[]>(initial?.results.models ?? []);
  // With a state to start in, the question for the starting text is the one that state already holds. A ref, so strict mode's second run skips it too.
  const seeded = useRef<string | null>(initial?.found?.query ?? null);
  const all = list.all;
  const split = useSplit(initial?.open === true);
  const closeSplit = split.close;
  // A new search is a new list: in a narrow pane, the list comes back.
  const searched = useRef(query);
  useEffect(() => {
    if (searched.current === query) return;
    searched.current = query;
    closeSplit();
  }, [query, closeSplit]);

  useEffect(() => {
    if (all === null || rested === "" || libraryRows(all, rested).length > 0) return;
    if (seeded.current === rested) return;
    seeded.current = null;
    let live = true;
    library.search(rested).then(
      (found) => {
        if (live) setAnswer({ query: rested, models: found.models });
      },
      (caught: unknown) => {
        if (live) setAnswer({ query: rested, error: actionErrorText(caught, "Could not ask the Ollama library.") });
      },
    );
    return () => {
      live = false;
    };
  }, [rested, all, library]);

  const local = useMemo(() => (all === null ? null : libraryRows(all, query)), [all, query]);
  const answered = answer?.query === query ? answer : null;
  let rows: readonly OllamaLibraryModel[] = kept;
  let phase: "loading" | "ready" | "checking" | "failed" = "loading";
  let problem: string | null = list.error ?? failure;
  if (local !== null) {
    if (local.length > 0 || query === "") {
      rows = local;
      phase = "ready";
    } else if (answered !== null && "models" in answered) {
      rows = answered.models;
      phase = "ready";
    } else if (answered !== null) {
      phase = "failed";
      problem = answered.error;
    } else {
      phase = "checking";
    }
  }

  // What the person last saw stays on screen while a name is checked, or when the check failed.
  if (phase === "ready" && rows.length > 0 && kept !== rows) setKept(rows);

  const typed = query !== "";
  const heading = phase === "checking" ? "checking the Ollama library…" : phase === "loading" ? "loading the Ollama library…" : typed ? `${rows.length} in the Ollama library` : "The Ollama library";
  const exact = rows.find((row) => row.name === query.split(":")[0]);
  const selected = rows.find((row) => row.name === (chosen?.query === query ? chosen.name : undefined)) ?? exact ?? rows[0];

  // Side by side, one name is chosen from the start. In a narrow pane only a name the person picked is marked.
  const marked = split.wide ? selected?.name : chosen?.query === query && rows.some((row) => row.name === chosen.name) ? chosen.name : undefined;

  const alert =
    problem === null ? null : (
      <p role="alert" className="shrink-0 pb-2 pt-3 text-sm text-deny">
        {problem}
      </p>
    );

  if (phase === "ready" && rows.length === 0) {
    const text = search.trim();
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {alert}
        <EmptyState
          icon={<OllamaMark size={28} />}
          title={typed ? `No “${text}” in the Ollama library` : "The Ollama library is empty right now"}
          actions={
            typed ? (
              <Button size="sm" onClick={onHuggingFace}>
                {`Search Hugging Face for “${text}”`}
              </Button>
            ) : undefined
          }
        >
          {typed ? "Check the spelling, or look for it on Hugging Face, where most models are published first." : "Try again in a moment, or look on Hugging Face."}
        </EmptyState>
      </div>
    );
  }

  const ramGb = listing?.ram_gb ?? null;
  const picked =
    selected === undefined ? null : (
      <>
        <DetailHead
          mark={
            <Avatar size="lg">
              <OllamaMark size={24} />
            </Avatar>
          }
          title={selected.name}
          blurb={selected.blurb}
          stats={[selected.sizes.length === 1 ? "1 size" : `${selected.sizes.length} sizes`]}
          link={{ href: libraryUrl(selected.name), label: "Open on ollama.com ↗", icon: <OllamaMark size={16} /> }}
        />
        {selected.sizes.length === 0 ? (
          <p className="mt-5 text-sm text-muted">The Ollama library lists no sizes for this name.</p>
        ) : (
          <>
            <SizeRows
              label={`Sizes of ${selected.name}`}
              intro="The same model with more or fewer parameters. Bigger ones answer better and need more memory."
              items={librarySizeItems(selected)}
              ramGb={ramGb}
              pulls={pulls}
              pull={pull}
              onStop={onStop}
            />
            <p className="mt-3 text-meta text-faint">{`The bar is the download against this Mac's ${ramGb === null ? "" : `${ramGb} GB of `}memory. golem downloads it with Ollama, and it keeps going if you leave.`}</p>
          </>
        )}
      </>
    );

  const names = (
    <ResultList label="Ollama library names" heading={heading} busy={phase === "checking" || phase === "loading"}>
      {rows.map((row) => (
        <ResultRow
          key={row.name}
          selected={row.name === marked}
          onSelect={() => {
            setChosen({ name: row.name, query });
            split.open();
          }}
          mark={
            <Avatar>
              <OllamaMark />
            </Avatar>
          }
          title={row.name}
          meta={<span>{sizesLine(row)}</span>}
        />
      ))}
    </ResultList>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {alert}
      <SplitPane list={names} detail={picked} split={split} backLabel="Names" />
    </div>
  );
}
