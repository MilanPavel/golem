import type { ReactNode } from "react";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { cn } from "../../../ui/cn.ts";
import { Code } from "../../../ui/code.tsx";
import { MemoryBar, PullAction, type Fit } from "./get-models-action.tsx";

/*
 * The pieces of a place with a list next to a detail (Hugging Face, and the Ollama library). They know nothing of
 * where the models come from: each place gives them words, numbers and the refs to download.
 */

/** A small pill that is pressed or not: a category, or a search to try. */
export function Chip({ pressed, onClick, children }: { pressed?: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-meta outline-offset-2 outline-clay focus-visible:outline-2",
        pressed === true ? "border-transparent bg-clay-soft font-semibold text-clay-ink" : "border-line-strong text-muted hover:border-faint hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** A square mark for a result: a letter, or an icon. */
export function Avatar({ children, size = "sm" }: { children: ReactNode; size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center border border-line bg-sunken font-semibold text-ink-soft",
        size === "lg" ? "size-10 rounded-lg text-lg" : "size-8 rounded-md text-sm",
      )}
    >
      {children}
    </span>
  );
}

/** The list on the left and the detail on the right. Each scrolls on its own. Below a medium width they stack. */
export function SplitPane({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 md:grid-cols-5 md:grid-rows-1">
      <div className="min-h-0 overflow-y-auto border-b border-line pb-3 md:col-span-2 md:border-b-0 md:border-r md:pr-2.5">{list}</div>
      <div className="min-h-0 overflow-y-auto py-4 md:col-span-3 md:pl-5">{detail}</div>
    </div>
  );
}

/** The list pane: a line above it (a count, or a quiet "asking…"), then the rows, which are `ResultRow`s. */
export function ResultList({ label, heading, busy = false, children }: { label: string; heading: string; busy?: boolean; children: ReactNode }) {
  return (
    <>
      <p role={busy ? "status" : undefined} className="px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-faint">
        {heading}
      </p>
      <ul aria-label={label} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </>
  );
}

/** One result: a mark, then the lines the place gives. The chosen one is marked with `aria-current`. */
export function ResultRow({ selected, onSelect, mark, above, title, meta }: { selected: boolean; onSelect: () => void; mark: ReactNode; above?: string; title: string; meta?: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected}
        onClick={onSelect}
        className={cn(
          "relative flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left outline-offset-2 outline-clay focus-visible:outline-2",
          selected ? "bg-surface shadow-sm" : "hover:bg-surface/70",
        )}
      >
        {selected ? <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-clay" /> : null}
        {mark}
        <span className="min-w-0 flex-1">
          {above === undefined ? null : <span className="block text-xs text-faint">{above}</span>}
          <span className="block break-words text-sm font-semibold">{title}</span>
          {meta === undefined ? null : <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-faint">{meta}</span>}
        </span>
      </button>
    </li>
  );
}

/** The top of the detail: a mark, the owner in small text, the name, a line of what it is, a line of numbers and a link out. */
export function DetailHead({ mark, above, title, blurb, stats, link }: { mark: ReactNode; above?: string; title: string; blurb?: string; stats: readonly ReactNode[]; link?: { href: string; label: string; icon: ReactNode } }) {
  return (
    <header>
      <div className="flex items-start gap-3.5">
        {mark}
        <div className="min-w-0">
          {above === undefined ? null : <p className="text-sm text-faint">{above}</p>}
          <h4 className="break-words text-lg font-semibold">{title}</h4>
          {blurb === undefined || blurb === "" ? null : <p className="text-sm text-faint">{blurb}</p>}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        {stats.map((stat, index) => (
          <span key={index}>{stat}</span>
        ))}
        {link === undefined ? null : (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2"
          >
            {link.icon}
            {link.label}
          </a>
        )}
      </p>
    </header>
  );
}

/** One size a person can download. */
export type SizeItem = {
  key: string;
  /** The plain name, such as Balanced. */
  title: string;
  /** The code beside it, such as Q4_K_M. */
  code?: string;
  /** A line of what it means. */
  note: string;
  sizeGb: number;
  fit: Fit;
  /** The ref `model.pull` takes. */
  ref: string;
  /** The name in the labels of the buttons. */
  name: string;
  /** The one golem picks: marked, and it has the primary button. */
  recommended: boolean;
  /** Where it is installed already. */
  installed?: boolean;
};

/** A line under the sizes when none sits comfortably. It informs; the buttons stay. */
export function fitNote(items: readonly SizeItem[], ramGb: number | null): string | null {
  if (items.length === 0 || items.some((item) => item.fit === "fits" || item.fit === null || item.fit === undefined)) return null;
  const mac = ramGb === null ? "this Mac's memory" : `this Mac's ${ramGb} GB of memory`;
  if (items.some((item) => item.fit === "tight")) return `No size sits comfortably in ${mac}. The tight ones run, with part of the work on the CPU, so they answer slower.`;
  return `Every size is bigger than ${mac}. You can still download one, but it will be very slow.`;
}

export type SizeRowsProps = {
  /** The label of the list of sizes. */
  label: string;
  intro: string;
  items: readonly SizeItem[];
  ramGb: number | null;
  pulls: PullsSnapshot;
  pull: (ref: string) => Promise<boolean>;
  onStop: (ref: string) => void;
};

/** "Pick a size": one row a size with its words, its weight on this Mac's memory and the action. */
export function SizeRows({ label, intro, items, ramGb, pulls, pull, onStop }: SizeRowsProps) {
  const note = fitNote(items, ramGb);
  return (
    <div role="group" aria-label={label} className="mt-5">
      <h5 className="text-sm font-semibold">Pick a size</h5>
      <p className="mb-1.5 text-sm text-faint">{intro}</p>
      <ul className="flex flex-col">
        {items.map((item) => {
          const failed = pulls.failed.get(item.ref);
          return (
            <li key={item.key} className={cn("rounded-lg border-t border-line px-2.5 py-2", item.recommended ? "border-transparent bg-clay-soft" : "")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="min-w-40 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <b className="text-sm font-semibold">{item.title}</b>
                    {item.code === undefined ? null : <Code tone="muted">{item.code}</Code>}
                    {item.recommended ? <span className="rounded-sm bg-allow-soft px-1.5 py-0.5 text-xs font-semibold tracking-wide text-allow">RECOMMENDED</span> : null}
                  </span>
                  {item.note === "" ? null : <small className="block text-sm text-faint">{item.note}</small>}
                </span>
                <span className="w-16 text-right text-xs tabular-nums text-ink-soft">{`${item.sizeGb} GB`}</span>
                <span className="w-36">
                  <MemoryBar fit={item.fit} sizeGb={item.sizeGb} ramGb={ramGb} />
                </span>
                <span className="w-36">
                  <PullAction target={{ ref: item.ref, name: item.name, installed: item.installed === true, tooBig: item.fit === "too_big" }} pulls={pulls} pull={pull} onStop={onStop} primary={item.recommended} />
                </span>
              </div>
              {failed === undefined || failed === "cancelled" ? null : <p className="pt-1 text-meta text-deny">{`Download failed: ${failed}`}</p>}
            </li>
          );
        })}
      </ul>
      {note === null ? null : <p className="mt-2 text-sm text-wait">{note}</p>}
    </div>
  );
}

/** A note in the detail: something the person should know. It never blocks. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-5 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink-soft">{children}</p>;
}

/** Nothing to show: an icon, a heading, a few words, and what to try. */
export function EmptyState({ icon, title, children, actions }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-10 text-center">
      {icon === undefined ? null : <div className="mb-2 flex justify-center">{icon}</div>}
      <h4 className="text-base font-semibold">{title}</h4>
      {children === undefined ? null : <p className="mx-auto mb-3 mt-1 max-w-prose text-sm text-muted">{children}</p>}
      {actions === undefined ? null : <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
