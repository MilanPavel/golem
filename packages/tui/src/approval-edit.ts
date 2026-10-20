import type { ApprovalLine } from "./approval.ts";
import type { PendingApproval } from "./chat-state.ts";
import { type Draft, draftAt } from "./edit.ts";

/** The waiting call's arguments, edited as JSON in the composer's place. */
export type ArgsEdit = {
  callId: string;
  draft: Draft;
  /** Why the last Enter did not approve: bad JSON, or what the daemon said. */
  error: string | null;
};

export type ParsedArgs = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

/** Rows the editor may take, in place of the composer's five. */
export const ARGS_EDIT_ROWS = 12;

export function startArgsEdit(approval: PendingApproval): ArgsEdit {
  const text = JSON.stringify(approval.args, null, 2);
  return { callId: approval.callId, draft: draftAt(text, text.length), error: null };
}

/** The edit, when it is still for the call that waits. */
export function liveArgsEdit(edit: ArgsEdit | null, approval: PendingApproval | null): ArgsEdit | null {
  return edit !== null && approval !== null && edit.callId === approval.callId ? edit : null;
}

export function parseArgs(text: string): ParsedArgs {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "the arguments must be one JSON object" };
  }
  return { ok: true, args: value as Record<string, unknown> };
}

/** The band above the editor: what is edited, the last error or the keys. */
export function argsEditLines(approval: PendingApproval, edit: ArgsEdit, columns: number): ApprovalLine[] {
  const width = Math.max(1, columns);
  return [
    { text: fit(`Edit the arguments of ${approval.name}, then allow it once`, width), bold: true, tone: "question" },
    edit.error === null
      ? { text: fit(`asked by ${approval.source}`, width), dim: true }
      : { text: fit(edit.error, width), tone: "del" },
    { text: fit("Enter allows once · Shift-Enter new line · Esc back", width) },
  ];
}

function fit(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ");
  return flat.length <= width ? flat : `${flat.slice(0, Math.max(0, width - 1))}…`;
}
