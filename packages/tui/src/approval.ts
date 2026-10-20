import type { PendingApproval } from "./chat-state.ts";
import { toolLabel } from "./layout-chat.ts";

export const APPROVAL_ROWS = 3;

export type ApprovalLine = {
  text: string;
  bold?: boolean;
  dim?: boolean;
};

/** The question above the composer while a run waits on a tool call. */
export function approvalLines(approval: PendingApproval, columns: number): ApprovalLine[] {
  const width = Math.max(1, columns);
  const label = toolLabel(approval.args);
  const call = label.length > 0 ? `${approval.name} ${label}` : approval.name;
  return [
    { text: fit(`Allow ${call}?`, width), bold: true },
    { text: fit(`asked by ${approval.source}`, width), dim: true },
    { text: fit("a once · s this session · w always (saves a rule) · d deny", width) },
  ];
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
