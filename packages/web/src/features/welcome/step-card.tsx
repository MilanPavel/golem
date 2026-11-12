import type { ReactNode } from "react";
import { cn } from "../../ui/cn.ts";
import { MarkGlyph } from "../setup/panel-body.tsx";

/** `wait` is a step that has not started or was left out: a dash, with its word for a screen reader. */
export type CardMark = "ok" | "attn" | "fail" | "spin" | "wait";

export function StepMark({ mark, waitWord = "waiting" }: { mark: CardMark; waitWord?: string }) {
  if (mark === "wait") {
    return (
      <span className="grid size-4 shrink-0 place-items-center font-mono text-sm leading-none text-faint">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{waitWord}: </span>
      </span>
    );
  }
  return <MarkGlyph mark={mark} />;
}

const TONE: Partial<Record<CardMark, string>> = { attn: "border-wait", fail: "border-deny" };
const DETAIL: Partial<Record<CardMark, string>> = { attn: "text-wait", fail: "text-deny" };

/** One part of setup as a card: its mark with its word, its name, what is the matter, and the fix beside it. */
export function StepCard({
  mark,
  name,
  detail,
  fix,
  children,
}: {
  mark: CardMark;
  name: string;
  detail: ReactNode;
  /** The buttons and links that fix it. */
  fix?: ReactNode;
  /** Under the row: an output, a command, a select. */
  children?: ReactNode;
}) {
  return (
    <li className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border border-line bg-surface px-4 py-3 text-left", TONE[mark])}>
      <span className="mt-0.5">
        <StepMark mark={mark} />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-semibold">{name}</p>
        <p className={cn("text-sm break-words text-muted", DETAIL[mark])}>{detail}</p>
      </div>
      {fix === undefined ? null : <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{fix}</div>}
      {children === undefined ? null : <div className="flex basis-full flex-col gap-2 pl-7">{children}</div>}
    </li>
  );
}

/** Words beside a spinner, read out as a status. */
export function Working({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <MarkGlyph mark="spin" />
      <span role="status">{children}</span>
    </span>
  );
}
