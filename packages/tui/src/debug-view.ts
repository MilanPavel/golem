import { formatWireLine, pingTotal, type WireLine } from "@golem/client";

import { bannerText } from "./chrome.ts";
import type { DebugState } from "./commands.ts";
import { wrapSpans } from "./layout-chat.ts";

export type CheckpointMessage = {
  role: string;
  text: string;
};

export type DebugTone = "dim" | "active" | "plain" | "note" | "pending";

export type DebugSpan = {
  text: string;
  tone: DebugTone;
};

export type DebugRow = {
  spans: DebugSpan[];
};

export type DebugLayout = {
  rows: DebugRow[];
  offsetFromBottom: number;
  lineCount: number;
};

export function holdDebugOffset(offset: number, previousLines: number, nextLines: number): number {
  if (offset <= 0 || previousLines <= 0) {
    return Math.max(0, offset);
  }
  return offset + Math.max(0, nextLines - previousLines);
}

export function historyNote(screenCount: number, modelCount: number | null): string | null {
  if (modelCount === null || screenCount === modelCount) {
    return null;
  }
  return `screen ${screenCount} · model ${modelCount}`;
}

export function layoutDebug(input: {
  debug: DebugState;
  rows: number;
  columns: number;
  wire: readonly WireLine[];
  messages: readonly CheckpointMessage[];
  screenCount: number;
  modelCount: number | null;
  offsetFromBottom?: number;
}): DebugLayout {
  if (input.rows <= 0 || input.columns <= 0) {
    return { rows: [], offsetFromBottom: 0, lineCount: 0 };
  }
  const note = historyNote(input.screenCount, input.modelCount);
  const showNote = note !== null && input.rows >= 2;
  const contentSlots = input.rows - 1 - (showNote ? 1 : 0);
  const content = contentRows(input);
  const fitted = fitContent(content, contentSlots, input.offsetFromBottom ?? 0);
  const rows = [
    clipRow(titleRow(input.debug, pingTotal(input.wire), fitted.offset > 0), input.columns),
    ...fitted.lines,
  ];
  if (showNote && note !== null) {
    rows.push(clipRow({ spans: [{ text: note, tone: "note" }] }, input.columns));
  }
  return { rows, offsetFromBottom: fitted.offset, lineCount: content.length };
}

function titleRow(debug: DebugState, pings: number, scrolled: boolean): DebugRow {
  const spans: DebugSpan[] = [
    { text: "debug", tone: "dim" },
    { text: "  ", tone: "dim" },
    { text: "wire", tone: debug.tab === "wire" ? "active" : "dim" },
    { text: "  ", tone: "dim" },
    { text: "model", tone: debug.tab === "model" ? "active" : "dim" },
  ];
  if (debug.hold) {
    spans.push({ text: "  hold", tone: "pending" });
  }
  if (pings > 0) {
    spans.push({ text: `  ping ×${pings}`, tone: "dim" });
  }
  spans.push({ text: "  tab", tone: "dim" }, { text: "  esc", tone: "dim" });
  if (scrolled) {
    spans.push({ text: "  ↑", tone: "dim" });
  }
  return { spans };
}

function contentRows(input: {
  debug: DebugState;
  columns: number;
  wire: readonly WireLine[];
  messages: readonly CheckpointMessage[];
}): DebugRow[] {
  if (input.debug.tab === "wire") {
    const protocol = input.wire.filter((line) => line.kind !== "ping");
    if (protocol.length === 0) {
      return [{ spans: [{ text: "No protocol messages yet.", tone: "dim" }] }];
    }
    return protocol.flatMap((line) => wrapLine(formatWireLine(line), input.columns, "plain"));
  }
  const rows = input.messages.flatMap((message) =>
    wrapLine(`${message.role}  ${message.text}`, input.columns, "plain"),
  );
  if (input.debug.held !== null && input.debug.held.length > 0) {
    rows.push(...wrapLine(`pending  ${input.debug.held}`, input.columns, "pending"));
  }
  if (rows.length === 0) {
    return [{ spans: [{ text: "No messages in the checkpoint.", tone: "dim" }] }];
  }
  return rows;
}

function wrapLine(text: string, columns: number, tone: DebugTone): DebugRow[] {
  return wrapSpans([{ text }], Math.max(1, columns)).map((spans) => ({
    spans:
      spans.length === 0
        ? [{ text: "", tone }]
        : spans.map((span) => ({ text: span.text, tone })),
  }));
}

function fitContent(
  lines: readonly DebugRow[],
  slots: number,
  offsetFromBottom: number,
): { lines: DebugRow[]; offset: number } {
  if (slots <= 0) {
    return { lines: [], offset: 0 };
  }
  if (lines.length <= slots) {
    return { lines: [...lines], offset: 0 };
  }
  const maxOffset = lines.length - slots;
  const offset = Math.min(Math.max(0, Math.floor(offsetFromBottom)), maxOffset);
  const end = lines.length - offset;
  return { lines: lines.slice(end - slots, end), offset };
}

function clipRow(row: DebugRow, columns: number): DebugRow {
  const total = row.spans.reduce((sum, span) => sum + span.text.length, 0);
  if (total <= columns) {
    return row;
  }
  if (row.spans.length === 1) {
    const span = row.spans[0];
    if (span === undefined) {
      return row;
    }
    return { spans: [{ text: bannerText(span.text, columns), tone: span.tone }] };
  }
  const joined = row.spans.map((span) => span.text).join("");
  return { spans: [{ text: bannerText(joined, columns), tone: "dim" }] };
}
