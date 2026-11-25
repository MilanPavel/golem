import type { ReviewItem } from "@golem/view";

import type { ApprovalLine } from "./approval.ts";
import { type Draft, draftAt } from "./edit.ts";

/** The answers to a workflow review (`workflow.review.answer`). */
export type ReviewVerdict = "approve" | "edit" | "reject";

/** The words of the keys under a review. */
export const REVIEW_KEYS = "y approve · r reply with edits · n reject";

/** The draft open in the editor, in the composer's place. */
export type ReviewEdit = {
  /** The run and step key of the review that is edited. */
  workflowRunId: string;
  key: string;
  draft: Draft;
  /** What the daemon said when the last Enter failed. */
  error: string | null;
  /** Enter was sent and the daemon has not answered yet, so keys wait. */
  submitting: boolean;
  /** The full draft is being fetched; keys other than Esc wait. */
  loading: boolean;
  /** Set when the full draft could not be fetched, so the editor holds only the cut preview. */
  warning: string | null;
};

/** The part of the client the review needs. */
export type ReviewClient = {
  workflowStatus(workflowRunId: string): Promise<{ reviews?: readonly { key: string; draft?: unknown }[] }>;
  answerWorkflowReview(workflowRunId: string, key: string, verdict: ReviewVerdict, text?: string): Promise<unknown>;
};

export const DRAFT_CUT_WARNING = "Could not load the full draft; this is cut at 200 characters";

/** Rows the editor may take, in place of the composer's five. */
export const REVIEW_EDIT_ROWS = 12;

/** How many lines of the draft the band shows. */
const PREVIEW_LINES = 3;

/** The editor, prefilled with the draft (all the item carries is its preview). */
export function startReviewEdit(item: ReviewItem): ReviewEdit {
  return { workflowRunId: item.workflowRunId, key: item.key, draft: draftAt(item.preview), error: null, submitting: false, loading: true, warning: null };
}

/** A draft as the editor's text: a string as it is, anything else as pretty JSON. */
export function draftText(draft: unknown): string {
  return typeof draft === "string" ? draft : (JSON.stringify(draft, null, 2) ?? "");
}

/** The full draft of the item's review from `workflow.status`, or null when the status does not list it. */
export async function loadReviewDraft(client: ReviewClient, item: Pick<ReviewItem, "workflowRunId" | "key">): Promise<string | null> {
  const status = await client.workflowStatus(item.workflowRunId);
  const review = status.reviews?.find((candidate) => candidate.key === item.key);
  return review === undefined || review.draft === undefined ? null : draftText(review.draft);
}

/** The edit once the fetch is over: the full draft, or the preview with a warning when it could not be had. */
export async function openReviewEdit(client: ReviewClient, item: ReviewItem): Promise<ReviewEdit> {
  const start = startReviewEdit(item);
  try {
    const text = await loadReviewDraft(client, item);
    if (text === null) return { ...start, loading: false, warning: DRAFT_CUT_WARNING };
    return { ...start, loading: false, draft: draftAt(text) };
  } catch {
    return { ...start, loading: false, warning: DRAFT_CUT_WARNING };
  }
}

/** Sends a key's answer with the item's run and key. */
export function submitReviewAnswer(
  client: ReviewClient,
  item: Pick<ReviewItem, "workflowRunId" | "key">,
  verdict: ReviewVerdict,
  text?: string,
): Promise<unknown> {
  const params = reviewAnswerParams(item, verdict, text);
  return client.answerWorkflowReview(params.workflowRunId, params.key, params.verdict, params.text);
}

/** The edit, when it is still for the review that waits. */
export function liveReviewEdit(edit: ReviewEdit | null, item: ReviewItem | null): ReviewEdit | null {
  return edit !== null && item !== null && edit.workflowRunId === item.workflowRunId && edit.key === item.key ? edit : null;
}

/** The params of `workflow.review.answer` for a key: the item's run and key, and the text of an edit. */
export function reviewAnswerParams(
  item: Pick<ReviewItem, "workflowRunId" | "key">,
  verdict: ReviewVerdict,
  text?: string,
): { workflowRunId: string; key: string; verdict: ReviewVerdict; text?: string } {
  return { workflowRunId: item.workflowRunId, key: item.key, verdict, ...(verdict === "edit" && text !== undefined ? { text } : {}) };
}

/** `3 waiting` when several reviews wait (the oldest shows first), else null. */
export function reviewPager(_index: number, count: number): string | null {
  return count < 2 ? null : `${String(count)} waiting`;
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** The draft's preview cut into lines of `width`, at most `PREVIEW_LINES`, the last one ending in an ellipsis when more follows. */
function previewLines(preview: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of preview.split("\n")) {
    let rest = raw.trimEnd();
    if (rest === "" && out.length === 0) continue;
    do {
      out.push(rest.slice(0, width));
      rest = rest.slice(width);
    } while (rest.length > 0);
  }
  if (out.length <= PREVIEW_LINES) return out;
  const kept = out.slice(0, PREVIEW_LINES);
  kept[PREVIEW_LINES - 1] = fit(`${kept[PREVIEW_LINES - 1] ?? ""}…`, width);
  return kept;
}

/** The band: the ask, the start of the draft, and the keys. */
export function reviewLines(item: ReviewItem, columns: number, pager: string | null = null): ApprovalLine[] {
  const width = Math.max(1, columns);
  const age = item.age === "" ? "" : ` · waiting ${item.age}`;
  const lines: ApprovalLine[] = [
    { text: fit(`Review · ${item.ask}${age}${pager === null ? "" : ` · ${pager}`}`, width), bold: true, tone: "question" },
  ];
  for (const text of previewLines(item.preview, width)) lines.push({ text });
  lines.push({ text: fit(REVIEW_KEYS, width) });
  return lines;
}

/** Rows the band wants. */
export function reviewRows(item: ReviewItem, columns: number, pager: string | null = null): number {
  return reviewLines(item, columns, pager).length;
}

/** The band above the editor: what is edited, the last error or the keys. */
export function reviewEditLines(item: ReviewItem, edit: ReviewEdit, columns: number): ApprovalLine[] {
  const width = Math.max(1, columns);
  return [
    { text: fit(`Edit the draft of "${item.ask}", then send it`, width), bold: true, tone: "question" },
    edit.loading
      ? { text: fit("loading draft…", width), dim: true }
      : edit.error !== null
        ? { text: fit(edit.error, width), tone: "del" }
        : edit.warning !== null
          ? { text: fit(edit.warning, width), tone: "del" }
          : { text: fit("the run continues with your text", width), dim: true },
    { text: fit("Enter sends · Shift-Enter new line · Esc back", width) },
  ];
}
