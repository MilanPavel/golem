import type { TurnSource } from "@golem/view";
import { memo, useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { addPendingChip, chipHrefs, chipLinks, CHIP, withoutOpenLink } from "./chips.ts";
import { highlightCodeBlocks } from "./highlight.ts";
import { renderMarkdown } from "./markdown.ts";
import { SourceCard, SourceSheet, type CardTarget } from "./source-card.tsx";

/** How long the card waits after the pointer leaves, so the pointer can cross into it. */
export const CARD_GRACE_MS = 140;
const NARROW = 640;

/** A phone or a touch screen: a tap opens the sheet, because there is no hover. */
function touchLike(): boolean {
  if (typeof window === "undefined") return false;
  const hoverNone = typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;
  return hoverNone || window.innerWidth < NARROW;
}

const CHIP_SELECTOR = `.${CHIP}:not([data-pending])`;

function chipAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(CHIP_SELECTOR) : null;
}

/** What the turn's sources are, as one string: it changes when a page is added or goes from hit to read. */
function signature(sources: readonly TurnSource[] | undefined): string {
  return sources === undefined ? "-" : sources.map((s) => `${s.kind}:${s.url}`).join("\n");
}

/**
 * Sanitized Markdown. This is the only file in the repo that may use dangerouslySetInnerHTML:
 * `renderMarkdown` is the only way HTML reaches it. Code blocks are coloured once the message is
 * finished, never while it streams.
 *
 * With `sources` (the pages the turn searched or read), the web links of the answer become chips after
 * the HTML is in the page: see `chipLinks`. A link still being written is held back until it is whole.
 * A chip opens a card on hover or focus, or a sheet on a tap where there is no hover.
 */
export const Markdown = memo(function Markdown({ text, streaming = false, sources }: { text: string; streaming?: boolean; sources?: readonly TurnSource[] }) {
  const [stable, setStable] = useState(sources);
  if (signature(stable) !== signature(sources)) setStable(sources);
  const shown = useMemo(() => (streaming ? withoutOpenLink(text, stable !== undefined) : { text, cut: false }), [text, streaming, stable]);
  const html = useMemo(() => renderMarkdown(shown.text), [shown.text]);
  const ref = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<CardTarget | null>(null);
  const [sheet, setSheet] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const quiet = useRef(false);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll("[data-pending]").forEach((el) => {
      el.remove();
    });
    if (stable !== undefined) {
      chipLinks(root, stable);
      if (shown.cut) addPendingChip(root);
    }
    if (streaming) return;
    void highlightCodeBlocks(root);
  }, [html, stable, streaming, shown.cut]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const close = () => {
    clearTimeout(timer.current);
    setTarget(null);
    setSheet(false);
  };
  const closeSoon = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(close, CARD_GRACE_MS);
  };
  const openCard = (chip: HTMLElement) => {
    clearTimeout(timer.current);
    setSheet(false);
    setTarget((now) => (now?.chip === chip ? now : { chip, hrefs: chipHrefs(chip) }));
  };

  useEffect(() => {
    if (target === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const { chip } = target;
      close();
      quiet.current = true;
      chip.focus();
      quiet.current = false;
    };
    const onScroll = () => {
      if (!sheet) close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [target, sheet]);

  const onOver = (event: MouseEvent) => {
    const chip = chipAt(event.target);
    if (chip !== null && !touchLike()) openCard(chip);
  };
  const onOut = (event: MouseEvent) => {
    if (chipAt(event.target) !== null && !touchLike()) closeSoon();
  };
  const onFocus = (event: FocusEvent) => {
    const chip = chipAt(event.target);
    if (chip !== null && !quiet.current) openCard(chip);
  };
  const onBlur = (event: FocusEvent) => {
    if (chipAt(event.target) !== null) closeSoon();
  };
  const onClick = (event: MouseEvent) => {
    const chip = chipAt(event.target);
    if (chip === null || !touchLike()) return;
    event.preventDefault();
    clearTimeout(timer.current);
    setTarget({ chip, hrefs: chipHrefs(chip) });
    setSheet(true);
  };

  return (
    <>
      <div
        key={signature(stable)}
        ref={ref}
        className="md"
        onMouseOver={onOver}
        onMouseOut={onOut}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {target === null || stable === undefined ? null : sheet ? (
        <SourceSheet target={target} sources={stable} onClose={close} />
      ) : (
        <SourceCard target={target} sources={stable} onEnter={() => { clearTimeout(timer.current); }} onLeave={closeSoon} />
      )}
    </>
  );
});
