import { displayUrl, hostHue, hostLetter, hostOf, sourceFor, type TurnSource } from "@golem/view";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../ui/cn.ts";
import { writeClipboard } from "../../ui/clipboard.ts";
import { formatClock } from "./format.ts";

/** What the card says about a link the turn never searched for or read. */
export const NOT_READ_WARNING =
  "golem didn't search for or read this page in this turn. The link came from the model alone. Check it before you trust it.";

/** The chip a card or sheet is open for, and the addresses it stands for (more than one for a merged chip). */
export type CardTarget = { chip: HTMLElement; hrefs: string[] };

/** A letter on a colour from the host: no image is fetched. The colours are in prose.css. */
export function SourceMark({ host, size }: { host: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn("src-mark", size === "md" && "src-mark-md", size === "lg" && "src-mark-lg")}
      style={{ "--mark-hue": hostHue(host) } as CSSProperties}
    >
      {hostLetter(host)}
    </span>
  );
}

function Tag({ kind }: { kind: "read" | "search" | "unread" }) {
  const look = kind === "read" ? "bg-allow-soft text-allow" : kind === "search" ? "bg-sunken text-muted" : "bg-wait-soft text-wait";
  return <span className={cn("rounded-full px-1.5 py-px text-meta", look)}>{kind === "read" ? "read" : kind === "search" ? "search hit" : "not read"}</span>;
}

/** The body of a card for one address: host, title, what golem saw, and what it did with the page. */
function CardBody({ href, sources, paging }: { href: string; sources: readonly TurnSource[]; paging?: ReactNode }) {
  const source = sourceFor(sources, href);
  const host = hostOf(href);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void writeClipboard(href).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 1500);
      },
      () => undefined,
    );
  };
  const when = source?.kind === "read" && source.at !== undefined ? formatClock(source.at) : "";
  return (
    <>
      <div className="flex items-center gap-2 px-3.5 pt-3 text-xs text-muted">
        <SourceMark host={host} size="md" />
        <span className="min-w-0 truncate">{host}</span>
        {paging}
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block px-3.5 pt-1.5 text-sm font-semibold leading-snug break-words text-ink hover:underline"
      >
        {source === undefined || source.title === "" ? displayUrl(href) : source.title}
      </a>
      {source === undefined ? (
        <p className="mx-3.5 mt-2 rounded-md bg-wait-soft px-2.5 py-1.5 text-xs text-wait">{NOT_READ_WARNING}</p>
      ) : source.snippet === "" ? null : (
        <p className="line-clamp-3 px-3.5 pt-1.5 text-sm text-muted">{source.snippet}</p>
      )}
      <div className="mt-2.5 flex items-center gap-2 border-t border-line px-3.5 py-2 text-xs text-faint">
        <Tag kind={source === undefined ? "unread" : source.kind} />
        {source === undefined ? null : <span>{source.kind === "read" ? (when === "" ? "fetched" : `fetched ${when}`) : "seen in results"}</span>}
        <span className="ml-auto flex gap-0.5">
          <button
            type="button"
            onClick={copy}
            className="cursor-pointer rounded-sm px-2 py-0.5 text-muted outline-offset-2 outline-clay hover:bg-sunken hover:text-ink focus-visible:outline-2"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm px-2 py-0.5 text-muted outline-offset-2 outline-clay hover:bg-sunken hover:text-ink focus-visible:outline-2"
          >
            Open ↗
          </a>
        </span>
      </div>
    </>
  );
}

const CARD_WIDTH = 340;
const GAP = 8;
const EDGE = 12;

/**
 * The hover card of a chip, in a portal: the first address, with ‹ › to page through a merged chip.
 * The pointer may move from the chip into the card (the page waits a moment before it closes it).
 */
export function SourceCard({
  target,
  sources,
  onEnter,
  onLeave,
}: {
  target: CardTarget;
  sources: readonly TurnSource[];
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [page, setPage] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>({ left: EDGE, top: EDGE });
  const count = target.hrefs.length;
  const href = target.hrefs[page % Math.max(count, 1)] ?? "";

  useLayoutEffect(() => {
    const rect = target.chip.getBoundingClientRect();
    const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * EDGE);
    const height = ref.current?.offsetHeight ?? 0;
    const left = Math.min(Math.max(EDGE, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - EDGE);
    const below = rect.bottom + GAP;
    const top = below + height > window.innerHeight && rect.top - GAP - height > 0 ? rect.top - GAP - height : below;
    setPlace({ left, top });
  }, [target, page]);

  const paging =
    count > 1 ? (
      <span className="ml-auto flex items-center gap-0.5 text-meta text-faint">
        <PageButton label="Previous source" onClick={() => { setPage((page + count - 1) % count); }}>
          ‹
        </PageButton>
        <span aria-live="polite">
          {(page % count) + 1}/{count}
        </span>
        <PageButton label="Next source" onClick={() => { setPage((page + 1) % count); }}>
          ›
        </PageButton>
      </span>
    ) : null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Source"
      data-source-card
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ position: "fixed", left: place.left, top: place.top, width: Math.min(CARD_WIDTH, window.innerWidth - 2 * EDGE) }}
      className="z-50 animate-fade-in rounded-xl border border-line-strong bg-surface text-ink shadow-soft"
    >
      <CardBody href={href} sources={sources} paging={paging} />
    </div>,
    document.body,
  );
}

function PageButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="size-5 cursor-pointer rounded-sm text-muted outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2"
    >
      {children}
    </button>
  );
}

/** The phone version of the card: a sheet from the bottom, with every address of the chip stacked. */
export function SourceSheet({ target, sources, onClose }: { target: CardTarget; sources: readonly TurnSource[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="Close sources" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-ink/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sources"
        data-source-sheet
        className="relative max-h-4/5 animate-fade-in overflow-y-auto rounded-t-2xl border-t border-line-strong bg-surface px-1 pt-2 pb-4 shadow-soft"
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" />
        <div className="flex flex-col gap-2 px-3">
          {target.hrefs.map((href) => (
            <div key={href} className="rounded-xl border border-line">
              <CardBody href={href} sources={sources} />
            </div>
          ))}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="cursor-pointer self-center rounded-md px-3 py-1 text-sm text-muted outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
