import { approvalQuestion, helperCardOf, isUseHelpersQuestion, type PendingApproval } from "@golem/view";
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
  if (isUseHelpersQuestion(approval)) {
    const jobs = helperCardOf({ args: approval.args }).jobs.length;
    return Math.min(APPROVAL_ROWS + jobs, Math.max(APPROVAL_ROWS, Math.floor(screenRows / 2)));
  }
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
  pager: string | null = null,
): ApprovalLine[] {
  const width = Math.max(1, columns);
  if (isUseHelpersQuestion(approval)) return helpersQuestionLines(approval, width, rows, pager);
  const label = toolLabel(approval.args);
  const call = label.length > 0 ? `${approval.name} ${label}` : approval.name;
  const diff = approval.diff === null ? [] : parseDiff(approval.diff);
  const diffRows = Math.max(0, rows - APPROVAL_ROWS);
  const shown = diffWindow(diff, offset, diffRows, width);
  const scrolls = diff.length > diffRows && diffRows > 0;
  const keys = `a once · s this session · w always (saves a rule) · e edit · d deny${pager === null ? "" : ` · ${pager}`}`;
  return [
    { text: fit(approvalQuestion(approval.name, approval.args) ?? `Allow ${call}?`, width), bold: true, tone: "question" },
    ...shown.map((line) => ({ text: line.text, tone: line.tone })),
    { text: fit(`asked by ${approval.source}${scrolls ? ` · diff ${diff.length} lines` : ""}`, width), dim: true },
    { text: fit(scrolls ? `${keys} · ↑↓ scroll` : keys, width) },
  ];
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** The keys of the batch question: `Enter run · d do it in the chat`. No "for this session" choice. */
export const HELPERS_KEYS = "Enter run · d do it in the chat · Esc the same";
/** The keys of the estimate card: Start, then "Use a cheaper model" when there is one, then "Do it in the chat". */
export function helpersEstimateKeys(cheaper: boolean): string {
  return cheaper ? "Enter start · c cheaper model · d do it in the chat · Esc the same" : "Enter start · d do it in the chat · Esc the same";
}

/** Why the question is asked: the setting, in the words of Settings. */
export const HELPERS_WHY = 'Use helpers is set to "Ask me first".';

/**
 * "Start these helpers?" (Use helpers: Ask me first): the head, one line per job (`agent · label`, then its brief,
 * cut to the width), and the two answers. When the jobs do not fit in `rows`, the last row says how many more.
 */
export function helpersQuestionLines(approval: PendingApproval, width: number, rows: number = APPROVAL_ROWS, pager: string | null = null): ApprovalLine[] {
  const card = helperCardOf({ args: approval.args, estimate: approval.estimate ?? null });
  const keys = card.estimate === null ? HELPERS_KEYS : helpersEstimateKeys(card.estimate.cheaperModel !== null);
  const room = Math.max(1, rows - APPROVAL_ROWS);
  const jobs = card.jobs.length > room ? card.jobs.slice(0, Math.max(0, room - 1)) : card.jobs;
  const hidden = card.jobs.length - jobs.length;
  return [
    { text: fit(`Start ${card.head}?`, width), bold: true, tone: "question" },
    ...jobs.map((job) => {
      const who = job.label === null ? job.agent : `${job.agent} · ${job.label}`;
      return { text: fit(job.brief === "" ? `  ${who}` : `  ${who} — ${job.brief.replace(/\s+/g, " ")}`, width) };
    }),
    ...(hidden > 0 ? [{ text: fit(`  … and ${String(hidden)} more`, width), dim: true }] : []),
    { text: fit(card.line ?? HELPERS_WHY, width), dim: true },
    { text: fit(pager === null ? keys : `${keys} · ${pager}`, width) },
  ];
}
