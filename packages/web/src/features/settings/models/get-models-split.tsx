import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { cn } from "../../../ui/cn.ts";
import { Button } from "../../../ui/button.tsx";
import { Code } from "../../../ui/code.tsx";
import { ChevronLeftIcon } from "../../../ui/icons.tsx";
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

/** The least width the two columns need side by side: 48rem, the width of Tailwind's `md` and `3xl`. Measured on the pane itself, so a Settings sidebar counts. */
const SPLIT_MIN_PX = 768;

/**
 * What the page gives the split so that Esc can step back inside it first. A split that shows only its detail puts a
 * function here that goes back to the list and returns true; the page asks it before it leaves for Ollama.
 */
export const SplitBackContext = createContext<MutableRefObject<(() => boolean) | null> | null>(null);

export type Split = {
  /** The pane is wide enough for the list and the detail side by side. */
  wide: boolean;
  /** Narrow only: the detail is shown in place of the list. */
  opened: boolean;
  open: () => void;
  close: () => void;
  ref: (element: HTMLDivElement | null) => void;
};

/**
 * Whether a list and its detail fit side by side, and, when they do not, whether the detail is the one showing.
 * Before the pane is measured (or where nothing can be measured) it counts as wide.
 */
export function useSplit(initialOpen = false): Split {
  // A callback ref, so a pane that shows up later (after the results come) is measured too.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(true);
  const [opened, setOpened] = useState(initialOpen);
  useLayoutEffect(() => {
    if (element === null) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      setWide(width === 0 || width >= SPLIT_MIN_PX);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  const open = useCallback(() => {
    setOpened(true);
  }, []);
  const close = useCallback(() => {
    setOpened(false);
  }, []);
  return { wide, opened, open, close, ref: setElement };
}

/**
 * The list on the left and the detail on the right. Each scrolls on its own. When the pane is too narrow for both, the
 * list has all of it, and a picked row shows the detail in its place with a way back. Both stay in the page, so the
 * list keeps its place.
 */
export function SplitPane({ list, detail, split, backLabel }: { list: ReactNode; detail: ReactNode; split: Split; /** What the list is called, in the way back: "Repos". */ backLabel: string }) {
  const { wide, opened, close, ref } = split;
  const stacked = !wide;
  const listPane = useRef<HTMLDivElement>(null);
  const detailPane = useRef<HTMLDivElement>(null);
  const shown = useRef(opened);
  const returning = useRef(false);
  const backRef = useContext(SplitBackContext);

  const goBack = useCallback(() => {
    returning.current = true;
    close();
  }, [close]);

  // The detail opened: its heading takes the focus. It closed by the way back: the picked row does.
  useEffect(() => {
    if (opened === shown.current) return;
    shown.current = opened;
    if (!stacked) return;
    if (opened) detailPane.current?.querySelector<HTMLElement>("h4")?.focus();
    else if (returning.current) listPane.current?.querySelector<HTMLElement>("[aria-current='true']")?.focus();
    returning.current = false;
  }, [opened, stacked]);

  // Esc in the detail goes back to the list. The page's own Esc asks this first.
  const active = stacked && opened;
  useEffect(() => {
    if (!active) return;
    const handle = () => {
      goBack();
      return true;
    };
    if (backRef !== null) {
      backRef.current = handle;
      return () => {
        if (backRef.current === handle) backRef.current = null;
      };
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      handle();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [active, backRef, goBack]);

  return (
    <div ref={ref} className={cn("min-h-0 flex-1", stacked ? "flex flex-col" : "grid grid-cols-5")}>
      <div ref={listPane} hidden={active} className={cn("min-h-0 overflow-y-auto pb-3", stacked ? "flex-1" : "col-span-2 border-r border-line pr-2.5")}>
        {list}
      </div>
      <div ref={detailPane} hidden={stacked && !opened} className={cn("min-h-0 overflow-y-auto", stacked ? "flex-1 pb-4" : "col-span-3 py-4 pl-5")}>
        {stacked ? (
          <Button size="sm" kind="ghost" className="-ml-2 mb-2" aria-label={`Back to ${backLabel.toLowerCase()}`} onClick={goBack}>
            <ChevronLeftIcon />
            {backLabel}
          </Button>
        ) : null}
        {detail}
      </div>
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
          <h4 tabIndex={-1} className="break-words text-lg font-semibold outline-none">
            {title}
          </h4>
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
  /** What golem knows will go wrong with this size. The button stays. */
  problem?: string;
};

/** A line under the sizes when none sits comfortably. It informs; the buttons stay. */
export function fitNote(items: readonly SizeItem[], ramGb: number | null): string | null {
  if (items.length === 0 || items.some((item) => item.fit === "fits" || item.fit === null || item.fit === undefined)) return null;
  const mac = ramGb === null ? "this Mac's memory" : `this Mac's ${ramGb} GB of memory`;
  if (items.some((item) => item.fit === "tight")) return `No size sits comfortably in ${mac}. The tight ones run, with part of the work on the CPU, so they answer slower.`;
  return `Every size is bigger than ${mac}. You can still download one, but it will be very slow.`;
}

const SIZE_MISSING_FILE = "Hugging Face is missing a file for this size, so the download can't finish right now.";
const MODEL_MISSING_FILE = "Hugging Face is missing a file for this model, so no size can finish downloading right now.";

/** The one problem every size shares, or null when sizes differ or have none. */
export function sharedProblem(items: readonly SizeItem[]): string | null {
  const first = items[0]?.problem;
  if (first === undefined || !items.every((item) => item.problem === first)) return null;
  return first === SIZE_MISSING_FILE ? MODEL_MISSING_FILE : first;
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
  // When every size has the same trouble, say it once.
  const shared = sharedProblem(items);
  return (
    <div role="group" aria-label={label} className="mt-5">
      <h5 className="text-sm font-semibold">Pick a size</h5>
      <p className="mb-1.5 text-sm text-faint">{intro}</p>
      {shared === null ? null : <p className="mb-1.5 text-sm text-wait">{shared}</p>}
      <ul className="@container flex flex-col">
        {items.map((item) => {
          const failed = pulls.failed.get(item.ref);
          return (
            <li key={item.key} className={cn("rounded-lg border-t border-line px-2.5 py-2", item.recommended ? "border-transparent bg-clay-soft" : "")}>
              {/* In a roomy detail: words, size, memory and the button on one line. In a tight one the size and the memory drop under the words, and the button stays at the top right. */}
              <div className="flex items-start gap-x-3 @xl:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-y-1 @xl:flex-row @xl:items-center @xl:gap-x-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <b className="text-sm font-semibold">{item.title}</b>
                      {item.code === undefined ? null : <Code tone="muted">{item.code}</Code>}
                      {item.recommended ? <span className="rounded-sm bg-allow-soft px-1.5 py-0.5 text-xs font-semibold tracking-wide text-allow">RECOMMENDED</span> : null}
                    </span>
                    {item.note === "" ? null : <small className="block text-sm text-faint">{item.note}</small>}
                  </span>
                  <span className="flex items-center gap-x-3">
                    <span className="shrink-0 text-xs tabular-nums text-ink-soft @xl:w-14 @xl:text-right">{`${item.sizeGb} GB`}</span>
                    <span className="shrink-0 @xl:w-36">
                      <MemoryBar fit={item.fit} sizeGb={item.sizeGb} ramGb={ramGb} />
                    </span>
                  </span>
                </div>
                {/* As wide as its content; on one line it keeps room for a progress bar, so the columns of the rows line up. */}
                <span className="shrink-0 @xl:min-w-32">
                  <PullAction target={{ ref: item.ref, name: item.name, installed: item.installed === true, tooBig: item.fit === "too_big" }} pulls={pulls} pull={pull} onStop={onStop} primary={item.recommended} />
                </span>
              </div>
              {shared !== null || item.problem === undefined ? null : <p className="pt-1 text-meta text-wait">{item.problem}</p>}
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
