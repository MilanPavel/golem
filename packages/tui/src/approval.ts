import type { PendingApproval } from "@golem/view";
import { type DiffTone, diffWindow, parseDiff } from "./diff-view.ts";
import { toolLabel } from "./layout-chat.ts";

/** The question, the rule that asked, and the keys. A diff goes between the first two. */
export const APPROVAL_ROWS = 3;

export type ApprovalLine = {
  text: string;
  bold?: boolean;
  dim?: boolean;
  tone?: DiffTone | "question";
};

/** Rows the band wants: its three, and the diff up to half the screen. */
export function approvalRows(approval: PendingApproval, screenRows: number): number {
  const diff = diffLineCount(approval);
  const room = Math.max(0, Math.floor(screenRows / 2) - APPROVAL_ROWS);
  return APPROVAL_ROWS + Math.min(diff, room);
}

export function diffLineCount(approval: PendingApproval): number {
  return approval.diff === null ? 0 : parseDiff(approval.diff).length;
}

/**
 * The question above the composer while a run waits on a tool call, in `rows` rows.
 * `offset` is the first diff row shown.
 */
export function approvalLines(
  approval: PendingApproval,
  columns: number,
  rows: number = APPROVAL_ROWS,
  offset = 0,
): ApprovalLine[] {
  const width = Math.max(1, columns);
  const label = toolLabel(approval.args);
  const call = label.length > 0 ? `${approval.name} ${label}` : approval.name;
  const diff = approval.diff === null ? [] : parseDiff(approval.diff);
  const diffRows = Math.max(0, rows - APPROVAL_ROWS);
  const shown = diffWindow(diff, offset, diffRows, width);
  const scrolls = diff.length > diffRows && diffRows > 0;
  const keys = "a once · s this session · w always (saves a rule) · e edit · d deny";
  return [
    { text: fit(`Allow ${call}?`, width), bold: true, tone: "question" },
    ...shown.map((line) => ({ text: line.text, tone: line.tone })),
    { text: fit(`asked by ${approval.source}${scrolls ? ` · diff ${diff.length} lines` : ""}`, width), dim: true },
    { text: fit(scrolls ? `${keys} · ↑↓ scroll` : keys, width) },
  ];
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
