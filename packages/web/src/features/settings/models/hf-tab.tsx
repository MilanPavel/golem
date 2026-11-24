import { useEffect, useRef, useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { HfFilesResult, HfSearchResult, ModelListResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Button } from "../../../ui/button.tsx";
import { Code } from "../../../ui/code.tsx";
import { HuggingFaceIcon } from "../../../ui/hugging-face-icon.tsx";
import { Avatar, Chip, DetailHead, EmptyState, Note, ResultList, ResultRow, SizeRows, SplitPane } from "./get-models-split.tsx";
import { hfSizeItems, paramsOf, shortCount, shortDate, splitRepo } from "./hf-sizes.ts";
import { useDebounced, type Timer } from "./use-debounced.ts";

/** What the tab needs of the page. Each call rejects with the daemon's message. */
export type HfActions = {
  /** An empty query asks for the popular repos. A pasted link to a repo works too. */
  search(query: string): Promise<HfSearchResult>;
  files(repo: string): Promise<HfFilesResult>;
};

export type HfTabProps = {
  hf: HfActions;
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  pull: (ref: string) => Promise<boolean>;
  onStop: (ref: string) => void;
  failure: string | null;
  /** The text of the page's search field. */
  search: string;
  /** Puts a text in the page's search field. */
  onSearch: (text: string) => void;
  /** How long the typing rests before Hugging Face is asked. */
  delayMs?: number;
  /** A timer a test can move. */
  timer?: Timer;
  /** The state the tab starts in, for the gallery: the results for the starting search, and one repo's sizes. */
  initial?: { results: HfSearchResult; files?: HfFilesResult; chosen?: string };
};

/** Searches to try while nothing is typed. */
const TRY = ["qwen", "gemma", "coder", "mistral", "llama", "gpt-oss"];

const REST_MS = 400;

function Tries({ search, onSearch }: { search: string; onSearch: (text: string) => void }) {
  return (
    <>
      {TRY.map((word) => (
        <Chip
          key={word}
          pressed={search.trim().toLowerCase() === word}
          onClick={() => {
            onSearch(word);
          }}
        >
          {word}
        </Chip>
      ))}
    </>
  );
}

/** The Hugging Face tab of Get models: repos on the left, the sizes of the chosen one on the right. */
export function HuggingFaceTab({ hf, listing, pulls, pull, onStop, failure, search, onSearch, delayMs = REST_MS, timer, initial }: HfTabProps) {
  // Only what is typed leaves this Mac, and only after the typing rests. The tab is mounted only while it is open.
  const query = useDebounced(search.trim(), delayMs, timer);
  const [results, setResults] = useState<HfSearchResult | null>(initial?.results ?? null);
  const [asked, setAsked] = useState(query);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(initial?.chosen ?? initial?.files?.repo ?? null);
  const [files, setFiles] = useState<Record<string, HfFilesResult>>(initial?.files === undefined ? {} : { [initial.files.repo]: initial.files });
  const [filesError, setFilesError] = useState<{ repo: string; text: string } | null>(null);
  const [now] = useState(() => new Date());
  // With a state to start in, the search for the starting text is the one that state already holds. A ref, so strict mode's second run skips it too.
  const seeded = useRef<string | null>(initial === undefined ? null : query);

  useEffect(() => {
    if (seeded.current === query) return;
    seeded.current = null;
    let live = true;
    setAsking(true);
    setError(null);
    hf.search(query).then(
      (found) => {
        if (!live) return;
        setResults(found);
        setAsked(query);
        setAsking(false);
      },
      (caught: unknown) => {
        if (!live) return;
        setError(actionErrorText(caught, "Could not search Hugging Face."));
        setAsking(false);
      },
    );
    return () => {
      live = false;
    };
  }, [query, hf]);

  const repos = results?.repos ?? [];
  const selected = repos.find((repo) => repo.id === chosen) ?? repos[0];
  const selectedId = selected?.id ?? null;
  const gated = selected?.gated === true;
  const loaded = selectedId !== null && files[selectedId] !== undefined;

  useEffect(() => {
    if (selectedId === null || gated || loaded) return;
    let live = true;
    hf.files(selectedId).then(
      (found) => {
        if (live) setFiles((all) => ({ ...all, [selectedId]: found }));
      },
      (caught: unknown) => {
        if (live) setFilesError({ repo: selectedId, text: actionErrorText(caught, "Could not read this repo.") });
      },
    );
    return () => {
      live = false;
    };
  }, [selectedId, gated, loaded, hf]);

  const ramGb = listing?.ram_gb ?? null;
  const problem = error ?? failure;
  const typed = query !== "";
  const empty = results !== null && repos.length === 0 && !asking;
  const heading = asking ? "asking Hugging Face…" : `${repos.length} ${typed ? "" : "popular "}${repos.length === 1 ? "repo" : "repos"}`;

  const bar = (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 py-2.5 text-sm text-muted">
      <HuggingFaceIcon />
      <span>{typed ? "GGUF repos, most downloaded first." : "Popular GGUF models right now. Try:"}</span>
      {typed || empty ? null : <Tries search={search} onSearch={onSearch} />}
      <span className="flex-1" />
      <span className="text-meta text-faint">No sign-in needed for public models. Only what you type leaves this Mac.</span>
    </div>
  );
  const alert =
    problem === null ? null : (
      <p role="alert" className="shrink-0 pb-2 text-sm text-deny">
        {problem}
      </p>
    );

  if (empty) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {bar}
        {alert}
        <EmptyState
          icon={<HuggingFaceIcon width="28" height="28" />}
          title={asked === "" ? "Hugging Face returned nothing right now" : `Hugging Face has no GGUF repos for “${asked}”`}
          actions={<Tries search={search} onSearch={onSearch} />}
        >
          {asked === "" ? "Try one of these searches, or paste a link to the repo." : "Try fewer words, or paste a link to the repo."}
        </EmptyState>
      </div>
    );
  }

  const list = (
    <ResultList label="Hugging Face repos" heading={heading} busy={asking}>
      {repos.map((repo) => {
        const { owner, name } = splitRepo(repo);
        const params = paramsOf(name);
        const date = shortDate(repo.updated, now);
        return (
          <ResultRow
            key={repo.id}
            selected={repo.id === selectedId}
            onSelect={() => {
              setChosen(repo.id);
            }}
            mark={<Avatar>{(owner[0] ?? name[0] ?? "?").toUpperCase()}</Avatar>}
            above={owner}
            title={name}
            meta={
              <>
                {params === null ? null : <Code tone="muted">{params}</Code>}
                <span>{`↓ ${shortCount(repo.downloads)}`}</span>
                <span>{`♥ ${shortCount(repo.likes)}`}</span>
                {date === null ? null : <span>{date}</span>}
                {repo.gated ? (
                  <span className="text-wait">
                    <span aria-hidden="true">🔒 </span>needs a token
                  </span>
                ) : null}
              </>
            }
          />
        );
      })}
    </ResultList>
  );

  let detail = null;
  if (selected !== undefined) {
    const { owner, name } = splitRepo(selected);
    const params = paramsOf(name);
    const date = shortDate(selected.updated, now);
    const found = files[selected.id];
    detail = (
      <>
        <DetailHead
          mark={<Avatar size="lg">{(owner[0] ?? name[0] ?? "?").toUpperCase()}</Avatar>}
          above={owner}
          title={name}
          stats={[params === null ? null : `${params} parameters`, `↓ ${shortCount(selected.downloads)}`, `♥ ${shortCount(selected.likes)}`, date === null ? null : `updated ${date}`].filter((stat) => stat !== null)}
          link={{ href: `https://huggingface.co/${selected.id}`, label: "Open on Hugging Face ↗", icon: <HuggingFaceIcon /> }}
        />
        {selected.gated ? (
          <>
            <Note>{`${owner} asks you to accept its terms on Hugging Face before a download. golem can't sign in to Hugging Face yet, so this one has to wait.`}</Note>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-faint">
              The same model from another publisher often needs no sign-in.
              <Button
                size="sm"
                onClick={() => {
                  onSearch(name.replace(/-GGUF$/i, ""));
                }}
              >
                {`Search for “${name.replace(/-GGUF$/i, "")}”`}
              </Button>
            </p>
          </>
        ) : found !== undefined ? (
          found.sizes.length === 0 ? (
            <p className="mt-5 text-sm text-muted">This repo has no GGUF sizes golem can download.</p>
          ) : (
            <>
              <SizeRows
                label={`Sizes of ${selected.id}`}
                intro="The same model, compressed more or less. Bigger files answer better and need more memory."
                items={hfSizeItems(selected.id, found, listing)}
                ramGb={ramGb}
                pulls={pulls}
                pull={pull}
                onStop={onStop}
              />
              <p className="mt-3 text-meta text-faint">{`The bar is the file against this Mac's ${ramGb === null ? "" : `${ramGb} GB of `}memory. golem downloads it with Ollama, and it keeps going if you leave.`}</p>
            </>
          )
        ) : filesError?.repo === selected.id ? (
          <p role="alert" className="mt-5 text-sm text-deny">
            {filesError.text}
          </p>
        ) : (
          <p role="status" className="mt-5 text-sm text-muted">
            asking Hugging Face…
          </p>
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {bar}
      {alert}
      {results === null ? (
        <p role="status" className="py-6 text-center text-sm text-muted">
          {problem === null ? "asking Hugging Face…" : ""}
        </p>
      ) : (
        <SplitPane list={list} detail={detail} />
      )}
    </div>
  );
}
