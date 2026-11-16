import { useId, useState, type ReactNode } from "react";
import { UNDO_WAIT, type TurnCard } from "@golem/view";
import { useTurnCards } from "../../store/page-context.tsx";
import type { ChangedFile } from "../../store/changes.ts";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { useDiffMode } from "../diff/index.ts";
import { timeAgo } from "../sessions/time-ago.ts";
import { useNow } from "../sessions/use-now.ts";
import { ChangeDiffPanel, Row } from "./file-row.tsx";
import { redoTargets, useUndo } from "./undo.tsx";
import { useWorkbenchWidth } from "./workbench-width.ts";

/** From this panel width, in rem, a diff may be shown side by side. Narrower, it is unified. */
const SPLIT_MIN_WIDTH = 40;

/** A row of the list: a turn and a path in it. */
export type OpenRow = { runId: string; path: string };

/** The key of a row in the set of open rows. */
export function rowKey(row: OpenRow): string {
  return JSON.stringify([row.runId, row.path]);
}

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
  /** The keys (`rowKey`) of the open rows. */
  open: ReadonlySet<string>;
  /** Opens a closed row and closes an open one. */
  onToggle: (row: OpenRow) => void;
  /** The content of an open row: the diff of that turn's last change to the file. */
  renderDiff: (card: TurnCard, file: TurnCard["files"][number]) => ReactNode;
  now: number;
  /** With it, a card has "Rewind to before this", or "Redo" when it is undone. `disabled` is true while a run is active. */
  undo?: { disabled: boolean; onRewind: (card: TurnCard) => void; onRedo: (card: TurnCard) => void };
};

/** The timeline: a strip of one dot per turn, then a card per turn, newest first. It reads nothing itself. */
export function TurnsView({ cards, open, onToggle, renderDiff, now, undo }: TurnsViewProps) {
  const prefix = useId();
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
              id={cardId(card.runId)}
            data-reverted={card.reverted ? "true" : undefined}
            className={cn("flex flex-col gap-1 rounded-md border border-line p-2", card.reverted && "opacity-70")}
          >
            <p className={cn("break-words text-sm font-medium", card.reverted ? "text-muted" : "text-ink")}>
              {card.number} · {titleOf(card)}
              {card.reverted ? <span className="ml-2 font-mono text-xs font-normal">undone</span> : null}
            </p>
            <p className="font-mono text-xs text-muted">{card.at === null ? card.line : `${agoText(card.at, now)} · ${card.line}`}</p>
            {undo === undefined ? null : (
              <div>
                <Button
                  size="sm"
                  disabled={undo.disabled}
                  title={undo.disabled ? UNDO_WAIT : undefined}
                  onClick={() => {
                    if (card.reverted) undo.onRedo(card);
                    else undo.onRewind(card);
                  }}
                >
                  {card.reverted ? "Redo" : "Rewind to before this"}
                  <span className="sr-only"> (turn {card.number})</span>
                </Button>
              </div>
            )}
            <ul className="flex flex-col gap-1">
              {card.files.map((file) => {
                const isOpen = open.has(rowKey({ runId: card.runId, path: file.path }));
                const row: ChangedFile = { ...file, change_ids: file.changeIds, stale: false };
                return (
                  <Row
                    key={file.path}
                    file={row}
                    open={isOpen}
                    onToggle={() => {
                      onToggle({ runId: card.runId, path: file.path });
                    }}
                  >
                    {renderDiff(card, file)}
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

/** The by-turn view of a session. Any number of files may be open; each shows its turn's change. */
export function TurnsTab({ sessionId }: { sessionId: string }) {
  const cards = useTurnCards(sessionId);
  const [mode, setMode] = useDiffMode();
  const [width] = useWorkbenchWidth();
  const now = useNow();
  const undo = useUndo(sessionId);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  return (
    <>
      <TurnsView
        cards={cards}
        open={open}
        onToggle={(row) => {
          const key = rowKey(row);
          setOpen((current) => {
            const next = new Set(current);
            if (!next.delete(key)) next.add(key);
            return next;
          });
        }}
        renderDiff={(_card, file) => (
          <ChangeDiffPanel
            sessionId={sessionId}
            changeId={file.changeIds[file.changeIds.length - 1] ?? null}
            mode={mode}
            onMode={setMode}
            canSplit={width >= SPLIT_MIN_WIDTH}
          />
        )}
        now={now}
        undo={{
          disabled: undo.disabled,
          onRewind: (card) => {
            undo.rewind(cards, card.runId);
          },
          onRedo: (card) => {
            undo.ask(redoTargets(card));
          },
        }}
      />
      {undo.dialogs}
    </>
  );
}
