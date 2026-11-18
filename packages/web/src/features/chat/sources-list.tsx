import { citeCounts, citedTimes, displayUrl, hostOf, type TurnSource } from "@golem/view";
import { useId, useMemo, useState } from "react";
import { cn } from "../../ui/cn.ts";
import { SourceMark } from "./source-card.tsx";

type Filter = "cited" | "all";
const STACK = 4;

/** `1 source` or `6 sources`. */
export function sourcesCount(n: number): string {
  return n === 1 ? "1 source" : `${n} sources`;
}

/**
 * The Sources button of a finished turn and the list it opens: stacked site marks and a count, then
 * every page the turn found or read, filtered to the ones the answer cites or all of them.
 * It renders two flex items: the button, and the list on a line of its own.
 */
export function TurnSources({ sources, answer }: { sources: readonly TurnSource[]; answer: string }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Filter | null>(null);
  const listId = useId();
  const counts = useMemo(() => citeCounts(sources, answer), [sources, answer]);
  if (sources.length === 0) return null;
  const cited = sources.filter((source) => citedTimes(counts, source) > 0);
  const filter = chosen ?? (cited.length > 0 ? "cited" : "all");
  const rows = filter === "cited" ? cited : sources;
  const hosts = [...new Set(sources.map((source) => hostOf(source.url)))].slice(0, STACK);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        data-sources-button
        onClick={() => {
          setOpen(!open);
        }}
        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface py-0.5 pr-2.5 pl-1 text-xs font-medium text-muted outline-offset-2 outline-clay hover:border-line-strong hover:text-ink focus-visible:outline-2 aria-expanded:border-line-strong aria-expanded:text-ink"
      >
        <span aria-hidden="true" className="inline-flex">
          {hosts.map((host, i) => (
            <span key={host} className={cn("rounded-full border-2 border-surface", i > 0 && "-ml-1.5")}>
              <SourceMark host={host} size="lg" />
            </span>
          ))}
        </span>
        <span>{sourcesCount(sources.length)}</span>
      </button>
      {open ? (
        <section id={listId} aria-label="Sources" data-sources-list className="basis-full overflow-hidden rounded-lg border border-line bg-surface">
          <header className="flex items-center gap-2.5 border-b border-line px-3.5 py-2 font-mono text-xs tracking-wide text-faint uppercase">
            <span>Sources</span>
            <span className="ml-auto flex gap-1 tracking-normal normal-case">
              <FilterButton pressed={filter === "cited"} onClick={() => { setChosen("cited"); }}>
                {`Cited · ${cited.length}`}
              </FilterButton>
              <FilterButton pressed={filter === "all"} onClick={() => { setChosen("all"); }}>
                {`All · ${sources.length}`}
              </FilterButton>
            </span>
          </header>
          {rows.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-muted">The answer cites no page.</p>
          ) : (
            <ul className="flex list-none flex-col divide-y divide-line">
              {rows.map((source) => (
                <SourceRow key={source.url} source={source} times={citedTimes(counts, source)} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}

function FilterButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="cursor-pointer rounded-full px-2 py-0.5 font-ui text-xs text-muted outline-offset-2 outline-clay focus-visible:outline-2 aria-pressed:bg-ink aria-pressed:text-bg"
    >
      {children}
    </button>
  );
}

function SourceRow({ source, times }: { source: TurnSource; times: number }) {
  const host = hostOf(source.url);
  return (
    <li>
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("grid cols-source-row items-start gap-2.5 px-3.5 py-2 text-sm -outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2", times === 0 && "opacity-70")}
      >
        <span className="mt-0.5">
          <SourceMark host={host} size="lg" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{source.title === "" ? displayUrl(source.url) : source.title}</span>
          <small className="block truncate font-mono text-xs text-faint">{displayUrl(source.url)}</small>
        </span>
        <span className="flex flex-col items-end gap-0.5 text-xs whitespace-nowrap text-faint">
          <span>{source.kind === "read" ? "read" : "search hit"}</span>
          <span>{times === 0 ? "not cited" : `cited ${times}×`}</span>
        </span>
      </a>
    </li>
  );
}
