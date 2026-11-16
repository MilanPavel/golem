import { useId, useState } from "react";
import type { TurnCard } from "@golem/view";
import { useChangeDiff, useTurnCards } from "../../store/page-context.tsx";
import type { ChangedFile, FileDiff } from "../../store/changes.ts";
import { cn } from "../../ui/cn.ts";
import { useDiffMode, type DiffMode } from "../diff/index.ts";
import { timeAgo } from "../sessions/time-ago.ts";
import { useNow } from "../sessions/use-now.ts";
import { DiffPanel, Row } from "./file-row.tsx";
import { useWorkbenchWidth } from "./workbench-width.ts";

/** From this panel width, in rem, a diff may be shown side by side. Narrower, it is unified. */
const SPLIT_MIN_WIDTH = 40;

/** The open row: a turn and a path in it. */
export type OpenRow = { runId: string; path: string };

/** `now` becomes "just now"; `2m`, `3h` and `5d` get "ago"; an older change shows its date. */
function agoText(iso: string, now: number): string {
  const text = timeAgo(iso, now);
  if (text === "now") return "just now";
  return /^\d+[mhd]$/.test(text) ? `${text} ago` : text;
}

function titleOf(card: TurnCard): string {
  return card.title === "" ? "a request" : card.title;
}

type TurnsViewProps = {
  cards: readonly TurnCard[];
  open: OpenRow | null;
  onOpen: (row: OpenRow | null) => void;
  /** The diff of the open row's change. */
  diff: FileDiff;
  mode: DiffMode;
  onMode: (mode: DiffMode) => void;
  canSplit: boolean;
  now: number;
};

/** The timeline: a strip of one dot per turn, then a card per turn, newest first. It reads nothing itself. */
export function TurnsView({ cards, open, onOpen, diff, mode, onMode, canSplit, now }: TurnsViewProps) {
  const prefix = useId();
  const panel = useId();
  if (cards.length === 0) {
    return <p className="text-sm text-muted">No changes yet. Each request that edits files shows up here as a turn.</p>;
  }
  const oldestFirst = [...cards].reverse();
  const cardId = (runId: string): string => `${prefix}-${runId}`;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ol aria-label="Turns, oldest first" className="flex items-center">
        {oldestFirst.map((card, index) => (
          <li key={card.runId} className="flex items-center">
            {index === 0 ? null : <span aria-hidden="true" className="h-px w-4 bg-line" />}
            <button
              type="button"
              aria-label={`Turn ${card.number}: ${titleOf(card)}`}
              title={`${card.number} · ${titleOf(card)}`}
              onClick={() => {
                document.getElementById(cardId(card.runId))?.scrollIntoView?.({ block: "nearest" });
              }}
              className="flex size-4 items-center justify-center rounded-full outline-offset-2 outline-clay focus-visible:outline-2"
            >
              <span aria-hidden="true" className={cn("size-2.5 rounded-full border border-line bg-faint", card.reverted && "opacity-50")} />
            </button>
          </li>
        ))}
      </ol>
      <ul className="flex flex-col gap-4">
        {cards.map((card) => (
          <li
            key={card.runId}
            id={cardId(card.runId)}
            data-reverted={card.reverted ? "true" : undefined}
            className={cn("flex flex-col gap-1 rounded-md border border-line p-2", card.reverted && "opacity-70")}
          >
            <p className={cn("break-words text-sm font-medium", card.reverted ? "text-muted" : "text-ink")}>
              {card.number} · {titleOf(card)}
              {card.reverted ? <span className="ml-2 font-mono text-xs font-normal">undone</span> : null}
            </p>
            <p className="font-mono text-xs text-muted">{card.at === null ? card.line : `${agoText(card.at, now)} · ${card.line}`}</p>
            <ul className="flex flex-col gap-1">
              {card.files.map((file) => {
                const isOpen = open?.runId === card.runId && open.path === file.path;
                const row: ChangedFile = { ...file, change_ids: file.changeIds, stale: false };
                return (
                  <Row
                    key={file.path}
                    file={row}
                    open={isOpen}
                    panel={panel}
                    onToggle={() => {
                      onOpen(isOpen ? null : { runId: card.runId, path: file.path });
                    }}
                  >
                    <DiffPanel diff={diff} mode={mode} onMode={onMode} canSplit={canSplit} />
                  </Row>
                );
              })}
            </ul>
          </li>
        ))}
        <li className="font-mono text-xs text-faint">session start</li>
      </ul>
    </div>
  );
}

/** The by-turn view of a session. One file is open at a time, and its diff is that turn's change. */
export function TurnsTab({ sessionId }: { sessionId: string }) {
  const cards = useTurnCards(sessionId);
  const [mode, setMode] = useDiffMode();
  const [width] = useWorkbenchWidth();
  const now = useNow();
  const [open, setOpen] = useState<OpenRow | null>(null);
  const card = open === null ? undefined : cards.find((item) => item.runId === open.runId);
  const file = card?.files.find((item) => item.path === open?.path);
  const diff = useChangeDiff(sessionId, file?.changeIds[file.changeIds.length - 1] ?? null);
  return (
    <TurnsView
      cards={cards}
      open={file === undefined ? null : open}
      onOpen={setOpen}
      diff={diff}
      mode={mode}
      onMode={setMode}
      canSplit={width >= SPLIT_MIN_WIDTH}
      now={now}
    />
  );
}
