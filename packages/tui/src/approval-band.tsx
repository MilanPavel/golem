import { Box, Text } from "ink";

import { type ApprovalLine, approvalLines } from "./approval.ts";
import { type ArgsEdit, argsEditLines } from "./approval-edit.ts";
import type { PendingApproval } from "./chat-state.ts";
import { DIFF_ADD, DIFF_DEL, DIFF_HUNK } from "./theme.ts";

/** The waiting tool call above the composer, with its diff when it changes a file. */
export function ApprovalBand({
  approval,
  edit,
  columns,
  height,
  offset,
}: {
  approval: PendingApproval;
  /** The call's arguments open in the editor, which replaces the diff. */
  edit: ArgsEdit | null;
  columns: number;
  height: number;
  offset: number;
}) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {(edit === null ? approvalLines(approval, columns, height, offset) : argsEditLines(approval, edit, columns))
        .slice(0, height)
        .map((line, index) => (
          <Text
            key={index}
            bold={line.bold === true}
            dimColor={line.dim === true || line.tone === "meta"}
            color={colorOf(line)}
            wrap="truncate-end"
          >
            {line.text}
          </Text>
        ))}
    </Box>
  );
}

function colorOf(line: ApprovalLine): string | undefined {
  switch (line.tone) {
    case "question":
      return "yellow";
    case "add":
      return DIFF_ADD;
    case "del":
      return DIFF_DEL;
    case "hunk":
      return DIFF_HUNK;
    default:
      return undefined;
  }
}
