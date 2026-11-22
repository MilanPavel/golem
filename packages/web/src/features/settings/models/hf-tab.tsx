import { useState } from "react";
import { actionErrorText } from "../../../store/errors.ts";
import type { HfFilesResult, HfRepo, HfSearchResult, HfSize } from "../../../store/models.ts";
import { Badge } from "../../../ui/badge.tsx";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { Code } from "../../../ui/code.tsx";
import { ChevronLeftIcon } from "../../../ui/icons.tsx";
import { Input } from "../../../ui/input.tsx";
import { timeAgo } from "../../sessions/time-ago.ts";

/** What the tab needs of the page. Each call rejects with the daemon's message. */
export type HfActions = {
  search(query: string): Promise<HfSearchResult>;
  files(repo: string): Promise<HfFilesResult>;
};

export type HfTabProps = {
  hf: HfActions;
  /** This Mac's memory in GB, or null when golem cannot tell. */
  ramGb: number | null;
  busy: string | null;
  failure: string | null;
  pull: (ref: string) => Promise<boolean>;
  /** The state the tab starts in, for the gallery. */
  initial?: { query: string; results: HfSearchResult; repo?: { id: string; files: HfFilesResult } };
};

/** The ref `model.pull` takes for one size of a repo. */
export function hfRef(repo: string, quant: string): string {
  return `ollama/hf.co/${repo}:${quant}`;
}

const GATED_TEXT = "Needs a Hugging Face token (later)";

function count(downloads: number): string {
  if (downloads >= 1_000_000) return `${(downloads / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (downloads >= 1000) return `${Math.round(downloads / 1000)}K`;
  return String(downloads);
}

function updatedText(updated: string | null | undefined, now: number): string | null {
  if (updated === null || updated === undefined) return null;
  const age = timeAgo(updated, now);
  if (age === "") return null;
  if (age === "now") return "updated just now";
  return /^\d+[mhd]$/.test(age) ? `updated ${age} ago` : `updated ${age}`;
}

function repoText(repo: HfRepo, now: number): string {
  return [`↓ ${count(repo.downloads)}`, updatedText(repo.updated, now)].filter((part) => part !== null).join(" · ");
}

/** The words for a size: Recommended first, then how it sits in this Mac's memory. */
export function sizeWords(size: HfSize): string[] {
  const words: string[] = [];
  if (size.recommended) words.push("Recommended");
  if (size.fit === "tight") words.push("Tight: it will spill to the CPU and run slower");
  else if (size.fit === "too_big") words.push("Too big for this Mac");
  else if (size.fit === "fits") {
    if (!size.recommended) words.push("Fits");
  } else words.push("Fit unknown");
  return words;
}

function FitBar({ size, ramGb }: { size: HfSize; ramGb: number | null }) {
  const share = ramGb === null || ramGb <= 0 ? 0 : Math.min(1, size.size_gb / ramGb);
  const color = size.fit === "too_big" ? "bg-deny" : size.fit === "tight" ? "bg-wait" : size.fit === "fits" ? "bg-allow" : "bg-faint";
  return (
    <div
      role="img"
      aria-label={ramGb === null ? "Memory of this Mac unknown" : `${size.size_gb} GB of ${ramGb} GB of memory`}
      className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-line-strong"
    >
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

type SizesProps = { repo: string; files: HfFilesResult; ramGb: number | null; busy: string | null; pull: HfTabProps["pull"]; onBack: () => void };

function Sizes({ repo, files, ramGb, busy, pull, onBack }: SizesProps) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" kind="ghost" onClick={onBack}>
          <ChevronLeftIcon aria-hidden="true" />
          Results
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3">
        <Code className="break-all">{repo}</Code>
        <a
          href={`https://huggingface.co/${repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2"
        >
          Open on Hugging Face ↗
        </a>
      </div>
      {files.sizes.length === 0 ? <p className="py-3 text-sm text-muted">This repo has no GGUF sizes golem can download.</p> : null}
      <ul aria-label={`Sizes of ${repo}`} className="flex flex-col">
        {files.sizes.map((size) => (
          <li key={size.quant} className={cn("flex flex-wrap items-center gap-3 border-t border-line px-1 py-2", size.recommended ? "bg-clay-soft" : "")}>
            <div className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2">
                <Code>{size.quant}</Code>
                <span className="text-sm text-muted">{`${size.size_gb} GB`}</span>
              </span>
              <small className={cn("block text-sm", size.fit === "too_big" ? "text-deny" : size.fit === "tight" ? "text-wait" : "text-faint")}>{sizeWords(size).join(" · ")}</small>
            </div>
            <FitBar size={size} ramGb={ramGb} />
            <Button
              size="sm"
              kind={size.recommended ? "primary" : "secondary"}
              disabled={busy !== null}
              aria-label={`Download ${size.quant}`}
              onClick={() => {
                void pull(hfRef(repo, size.quant));
              }}
            >
              Download
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-meta text-faint">The bar is the file against this Mac&apos;s memory. The download keeps going if you close this.</p>
    </div>
  );
}

/** The Hugging Face tab of Get models: search for GGUF repos, open one, pick a size. */
export function HuggingFaceTab({ hf, ramGb, busy, failure, pull, initial }: HfTabProps) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [results, setResults] = useState<HfSearchResult | null>(initial?.results ?? null);
  const [repo, setRepo] = useState<{ id: string; files: HfFilesResult } | null>(initial?.repo ?? null);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  async function search(): Promise<void> {
    const text = query.trim();
    if (text === "") return;
    setAsking("search");
    setError(null);
    try {
      setResults(await hf.search(text));
    } catch (caught) {
      setError(actionErrorText(caught, "Could not search Hugging Face."));
    } finally {
      setAsking(null);
    }
  }

  async function open(id: string): Promise<void> {
    setAsking(id);
    setError(null);
    try {
      setRepo({ id, files: await hf.files(id) });
    } catch (caught) {
      setError(actionErrorText(caught, "Could not read this repo."));
    } finally {
      setAsking(null);
    }
  }

  const problem = error ?? failure;
  return (
    <div className="flex flex-col gap-2">
      {repo === null ? (
        <>
          <form
            className="flex gap-2"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              aria-label="Search Hugging Face"
              placeholder="Search Hugging Face"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" size="sm" kind="primary" disabled={asking !== null || query.trim() === ""}>
              Search
            </Button>
          </form>
          <p className="text-sm text-muted">GGUF repos first, most downloaded first. No sign-in needed for public models. Only what you type leaves this Mac.</p>
        </>
      ) : null}
      {problem === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {problem}
        </p>
      )}
      {asking === "search" ? <p className="text-sm text-muted">asking Hugging Face…</p> : null}
      {repo !== null ? (
        <Sizes
          repo={repo.id}
          files={repo.files}
          ramGb={ramGb}
          busy={busy}
          pull={pull}
          onBack={() => {
            setRepo(null);
            setError(null);
          }}
        />
      ) : results === null ? null : results.repos.length === 0 ? (
        <p className="py-3 text-sm text-muted">Hugging Face has no GGUF repos for that. Try fewer words.</p>
      ) : (
        <ul aria-label="Hugging Face repos" className="flex flex-col">
          {results.repos.map((item) => (
            <li key={item.id} className="border-t border-line">
              {item.gated ? (
                <div className="flex items-center gap-3 px-1 py-2">
                  <div className="min-w-0 flex-1">
                    <Code tone="muted" className="break-all">
                      {item.id}
                    </Code>
                    <small className="block text-sm text-faint">{repoText(item, now)}</small>
                  </div>
                  <Badge>{GATED_TEXT}</Badge>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={asking !== null}
                  aria-label={`Open ${item.id}`}
                  onClick={() => {
                    void open(item.id);
                  }}
                  className="flex w-full items-center gap-3 rounded-sm px-1 py-2 text-left outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <Code className="break-all">{item.id}</Code>
                    <small className="block text-sm text-faint">{repoText(item, now)}</small>
                  </span>
                  <span aria-hidden="true" className="text-faint">
                    ›
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
