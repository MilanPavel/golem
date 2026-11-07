import type { Mark, SetupLine } from "@golem/view";
import { useEffect, useRef, type ReactNode } from "react";
import type { PullEntry } from "../../store/pulls.ts";
import { cn } from "../../ui/cn.ts";
import { CopyCommand } from "../../ui/copy-command.tsx";
import { CheckIcon } from "../../ui/icons.tsx";
import { PullBar, pullShare, pullText } from "../models/index.ts";
import type { PanelView } from "./setup-ui.ts";
import "./setup.css";

/** What a mark means in words, so colour is never the only signal. */
const MARK_WORDS: Record<Mark, string> = { ok: "done", fail: "failed", attn: "needs attention", spin: "working" };

/** The mark of a line with its word for a screen reader. The Settings form uses it for its cards too. */
export function MarkGlyph({ mark }: { mark: Mark }) {
  const word = <span className="sr-only">{MARK_WORDS[mark]}: </span>;
  switch (mark) {
    case "ok":
      return (
        <span className="grid size-4 shrink-0 place-items-center text-allow">
          <CheckIcon />
          {word}
        </span>
      );
    case "fail":
      return (
        <span className="grid size-4 shrink-0 place-items-center font-mono text-sm leading-none text-deny">
          <span aria-hidden="true">✗</span>
          {word}
        </span>
      );
    case "attn":
      return (
        <span className="grid size-4 shrink-0 place-items-center font-mono text-sm leading-none font-semibold text-wait">
          <span aria-hidden="true">!</span>
          {word}
        </span>
      );
    case "spin":
      return (
        <span className="grid size-4 shrink-0 place-items-center">
          <span aria-hidden="true" className="setup-pulse size-2 bg-clay" />
          {word}
        </span>
      );
  }
}

export type PanelBodyProps = {
  view: PanelView;
  /** A click on an option: its index in the panel's choices. */
  onChoose: (index: number) => void;
  /** The running download, for a panel that draws one. */
  pull?: PullEntry | undefined;
  /** The option that has focus follows the selection, once `focus` is set. */
  focus: boolean;
};

type Block = { kind: "line"; line: Exclude<SetupLine, { kind: "option" }>; at: number } | { kind: "options"; items: { line: Extract<SetupLine, { kind: "option" }>; at: number }[] };

/** Consecutive option lines make one list; the rest keep their order. */
function blocks(lines: readonly SetupLine[]): Block[] {
  const out: Block[] = [];
  lines.forEach((line, at) => {
    if (line.kind !== "option") {
      out.push({ kind: "line", line, at });
      return;
    }
    const last = out.at(-1);
    if (last?.kind === "options") last.items.push({ line, at });
    else out.push({ kind: "options", items: [{ line, at }] });
  });
  return out;
}

/** One panel's lines, drawn the page's way: text, marked status rows, and a list of choices. */
export function PanelBody({ view, onChoose, pull, focus }: PanelBodyProps) {
  const selected = useRef<HTMLElement | null>(null);
  const selectedAt = view.offset + view.lines.filter((line) => line.kind === "option").findIndex((line) => line.selected);
  // Focus follows the selection, but a tick of the clock must not take it from the Copy button.
  useEffect(() => {
    if (focus) selected.current?.focus();
  }, [focus, view.id, selectedAt]);

  const parts = blocks(view.lines);
  const firstOptions = parts.findIndex((part) => part.kind === "options");
  let optionIndex = view.offset;
  const out: ReactNode[] = [];
  parts.forEach((part, at) => {
    if (at === firstOptions && view.command !== null) {
      out.push(
        <div key="command" className="my-1">
          <CopyCommand command={view.command} />
        </div>,
      );
    }
    if (part.kind === "line") {
      out.push(<LineView key={`l${part.at}`} line={part.line} />);
      if (view.download !== null && part.at === 0) {
        out.push(
          <PullBar
            key="bar"
            label={`Downloading ${view.download.label}`}
            share={pullShare(pull, null)}
            text={pullText(pull)}
          />,
        );
      }
      return;
    }
    out.push(
      <div key={`o${part.items[0]?.at ?? at}`} role="group" aria-label="Choices" className="mt-1 flex flex-col gap-1">
        {part.items.map(({ line }) => {
          const index = optionIndex++;
          const href = view.links.get(index);
          const common = {
            ref: (node: HTMLElement | null) => {
              if (line.selected) selected.current = node;
            },
            "aria-current": line.selected ? ("true" as const) : undefined,
            className: cn(
              "flex w-full items-baseline gap-3 rounded-md border px-3 py-2 text-left text-sm outline-offset-2 outline-clay focus-visible:outline-2",
              line.selected ? "border-clay bg-sunken text-ink" : "border-transparent text-ink hover:bg-line",
            ),
          };
          const body = (
            <>
              <span className="font-medium">{line.label}</span>
              {line.detail === "" ? null : <span className="ml-auto font-mono text-xs text-muted">{line.detail.trim()}</span>}
            </>
          );
          return href === undefined ? (
            <button key={index} type="button" {...common} onClick={() => onChoose(index)}>
              {body}
            </button>
          ) : (
            <a
              key={index}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              {...common}
              onClick={(event) => {
                event.preventDefault();
                onChoose(index);
              }}
            >
              {body}
            </a>
          );
        })}
      </div>,
    );
  });
  if (view.waitLink !== null) {
    out.push(
      <a
        key="wait"
        href={view.waitLink.href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 w-fit text-sm text-clay-ink underline underline-offset-2"
      >
        {view.waitLink.label}
      </a>,
    );
  }
  return <div className="flex flex-col gap-1">{out}</div>;
}

function LineView({ line }: { line: Exclude<SetupLine, { kind: "option" }> }) {
  switch (line.kind) {
    case "blank":
      return <div aria-hidden="true" className="h-2" />;
    case "title":
      return <p className="text-sm font-semibold text-ink">{line.text}</p>;
    case "text":
      return <p className={cn("text-sm", line.dim === true ? "text-muted" : "text-ink")}>{line.text.trim() === "" ? " " : line.text}</p>;
    case "status":
      return (
        <p className="flex items-center gap-2 text-sm text-ink">
          <MarkGlyph mark={line.mark} />
          <span>{line.text}</span>
          {line.right === undefined ? null : <span className="ml-auto font-mono text-xs text-muted">{line.right}</span>}
        </p>
      );
    case "row":
      return (
        <p className="flex items-baseline gap-2 text-sm">
          <MarkGlyph mark={line.mark} />
          <span className="w-16 shrink-0 font-medium text-ink">{line.label}</span>
          <span className="min-w-0 text-muted">{line.text}</span>
        </p>
      );
    case "field":
      return <p className="font-mono text-sm text-ink">{line.text}</p>;
  }
}
