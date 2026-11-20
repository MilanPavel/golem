import { batchCard, withLocal, type BatchHelper, type CardRow, type CardTone, type Detail, type HelperBatch, type IsLocal } from "@golem/view";

import type { Span } from "./layout-chat.ts";

/**
 * The batch card of one `delegate` call as a tree under the turn (ADR-059). The words come from the
 * view's `batchCard`; this file only places them. Quiet is the head line, dim. Normal adds a row per
 * helper. Verbose adds a line under each row with its model and why.
 */

const GAP = "  ";

/** The state mark of a helper, as in the session switcher: `■` working, `□` queued, `✓` done, `✗` failed or stopped. */
export function helperMark(helper: Pick<BatchHelper, "state" | "reason">): Span {
  switch (helper.state) {
    case "running":
      return { text: "■", color: "green" };
    case "waiting":
      return helper.reason === "you" ? { text: "■", warn: true } : { text: "□", dim: true };
    case "queued":
      return { text: "□", dim: true };
    case "done":
      return { text: "✓", color: "green" };
    case "failed":
      return { text: "✗", color: "red" };
    case "stopped":
      return { text: "✗", warn: true };
  }
}

export function toneSpan(text: string, tone: CardTone): Span {
  switch (tone) {
    case "ok":
      return { text, color: "green" };
    case "bad":
      return { text, color: "red" };
    case "wait":
      return { text, warn: true };
    case "run":
      return { text };
  }
}

function size(text: string): number {
  return [...text].length;
}

function sizeOf(spans: readonly Span[]): number {
  return spans.reduce((sum, span) => sum + size(span.text), 0);
}

/** The text cut to `room` characters, with an ellipsis. */
function cut(text: string, room: number): string {
  if (size(text) <= room) return text;
  if (room <= 0) return "";
  return `${[...text].slice(0, room - 1).join("")}…`;
}

/**
 * One row: `lead`, the name and what ran, a gap, then `tail` flush right. Only the middle is cut:
 * what ran first, then the name. The tail is never cut.
 */
export function fitRow(lead: readonly Span[], name: string, ran: string, tail: readonly Span[], width: number): Span[] {
  const room = Math.max(0, width - sizeOf(lead) - sizeOf(tail) - GAP.length);
  const ranRoom = room - size(name) - GAP.length;
  const left: Span[] = [{ text: cut(name, room), bold: true }];
  if (ran !== "" && ranRoom >= 2) left.push({ text: GAP }, { text: cut(ran, ranRoom), dim: true });
  const pad = Math.max(1, width - sizeOf(lead) - sizeOf(left) - sizeOf(tail));
  return [...lead, ...left, { text: " ".repeat(pad) }, ...tail];
}

/** The tail of a helper row: the number, the state, the time. When the row is too narrow the number goes, then the time; the state stays. */
function tailOf(row: CardRow, room: number): Span[] {
  const parts = (number: boolean, took: boolean): Span[] => {
    const spans: Span[] = [];
    if (number && row.number !== null) spans.push({ text: row.number, dim: true }, { text: GAP });
    spans.push(toneSpan(row.right, row.tone));
    if (took && row.took !== null) spans.push({ text: `${GAP}${row.took}`, dim: true });
    return spans;
  };
  for (const [number, took] of [
    [true, true],
    [false, true],
    [false, false],
  ] as const) {
    const spans = parts(number, took);
    if (sizeOf(spans) <= room) return spans;
  }
  return parts(false, false);
}

/**
 * The lines of the batch of one `delegate` call. `isLocal` marks the helpers' models where it can
 * say, which decides the number of a row (the window saved, or the cost first).
 */
export function batchLines(batch: HelperBatch, width: number, detail: Detail = "normal", isLocal?: IsLocal): Span[][] {
  const card = batchCard(isLocal === undefined ? batch : withLocal(batch, isLocal), detail, "tui");
  if (detail === "quiet") {
    return [[{ text: cut(card.head, width), dim: true }]];
  }
  const lines: Span[][] = [fitRow([{ text: "▾ " }], card.total ?? card.head, "", [toneSpan(card.right, card.tone)], width)];
  for (const [index, row] of card.rows.entries()) {
    const helper = batch.helpers[index];
    if (helper === undefined) continue;
    const last = index === card.rows.length - 1;
    const branch = last ? "  └─ " : "  ├─ ";
    const lead: Span[] = [{ text: branch, dim: true }, helperMark(helper), { text: " " }];
    // Keep a few cells for the name, then give the rest to the tail.
    const tailRoom = Math.max(0, width - sizeOf(lead) - Math.min(size(row.name), 8) - GAP.length);
    lines.push(fitRow(lead, row.name, row.ran, tailOf(row, tailRoom), width));
    if (row.model !== "") {
      lines.push([{ text: cut(`${last ? "     " : "  │  "}   ${row.model}`, width), dim: true }]);
    }
  }
  return lines;
}
